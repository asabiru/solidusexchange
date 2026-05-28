<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Models\AmlScreeningLog;
use App\Models\BuyRequest;
use App\Models\CustodialDeposit;
use App\Models\ExchangeRequest;
use App\Models\SanctionedAddress;
use App\Models\SellRequest;
use App\Services\ExchangePipeline\ExchangeAmlService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Yajra\DataTables\Facades\DataTables;

class SanctionedAddressController extends Controller
{
    public function index()
    {
        $stats = [
            'total'     => SanctionedAddress::active()->count(),
            'blocked'   => SanctionedAddress::active()->where('severity', 'blocked')->count(),
            'high_risk' => SanctionedAddress::active()->where('severity', 'high_risk')->count(),
            'monitor'   => SanctionedAddress::active()->where('severity', 'monitor')->count(),
            'sources'   => SanctionedAddress::active()->distinct('source')->pluck('source')->count(),
        ];
        return view('admin.custodial.sanctions.index', compact('stats'));
    }

    public function list(Request $request)
    {
        $query = SanctionedAddress::query()->orderByDesc('id');

        if ($request->filled('source')) {
            $query->where('source', $request->source);
        }
        if ($request->filled('severity')) {
            $query->where('severity', $request->severity);
        }
        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }

        return DataTables::of($query)
            ->addColumn('address_short', fn($s) => strlen($s->address) > 16
                ? substr($s->address, 0, 10) . '...' . substr($s->address, -6)
                : $s->address)
            ->addColumn('severity_badge', function ($s) {
                return match ($s->severity) {
                    'blocked'    => '<span class="badge bg-soft-danger text-danger">Blocked</span>',
                    'high_risk'  => '<span class="badge bg-soft-warning text-warning">High Risk</span>',
                    'monitor'    => '<span class="badge bg-soft-info text-info">Monitor</span>',
                    default      => '<span class="badge bg-soft-secondary text-body">' . $s->severity . '</span>',
                };
            })
            ->addColumn('source_badge', function ($s) {
                $labels = [
                    'ofac' => 'OFAC (US)', 'eu' => 'EU', 'uk' => 'UK OFSI',
                    'un' => 'UN', 'russia_cb' => 'ЦБ РФ', 'russia_min' => 'Минфин РФ',
                    'manual' => 'Manual',
                ];
                $label = $labels[$s->source] ?? $s->source;
                $colors = [
                    'ofac' => 'danger', 'eu' => 'primary', 'uk' => 'info',
                    'un' => 'warning', 'russia_cb' => 'success', 'russia_min' => 'success',
                    'manual' => 'secondary',
                ];
                $color = $colors[$s->source] ?? 'secondary';
                return "<span class=\"badge bg-soft-{$color} text-{$color}\">{$label}</span>";
            })
            ->addColumn('status_badge', function ($s) {
                return match ($s->status) {
                    'active'   => '<span class="badge bg-soft-success text-success">Active</span>',
                    'expired'  => '<span class="badge bg-soft-secondary text-body">Expired</span>',
                    'revoked'  => '<span class="badge bg-soft-warning text-warning">Revoked</span>',
                    default    => '<span class="badge bg-soft-secondary text-body">' . $s->status . '</span>',
                };
            })
            ->addColumn('action', function ($s) {
                $html = '';
                if ($s->status === 'active') {
                    $revokeUrl = route('admin.sanctionedAddressRevoke', $s->id);
                    $html .= "<a href=\"{$revokeUrl}\" class=\"btn btn-sm btn-outline-warning\" onclick=\"return confirm('Revoke this entry?')\"><i class=\"bi-x-circle\"></i></a> ";
                }
                $deleteUrl = route('admin.sanctionedAddressDelete', $s->id);
                $html .= "<a href=\"{$deleteUrl}\" class=\"btn btn-sm btn-outline-danger\" onclick=\"return confirm('Delete this entry permanently?')\"><i class=\"bi-trash\"></i></a>";
                return $html;
            })
            ->rawColumns(['severity_badge', 'source_badge', 'status_badge', 'action'])
            ->make(true);
    }

    public function store(Request $request)
    {
        $request->validate([
            'address'       => 'required|string|max:255',
            'currency_code' => 'nullable|string|max:20',
            'source'        => 'required|string|max:50',
            'entity_name'   => 'nullable|string|max:255',
            'entity_type'   => 'nullable|string|max:30',
            'reason'        => 'nullable|string|max:1000',
            'severity'      => 'required|in:blocked,high_risk,monitor',
        ]);

        $normalized = SanctionedAddress::normalizeAddress($request->address);

        $existing = SanctionedAddress::where('address', $normalized)
            ->where('source', $request->source)
            ->first();

        if ($existing) {
            return back()->with('error', 'This address+source combination already exists.');
        }

        SanctionedAddress::create([
            'address'       => $normalized,
            'currency_code' => $request->currency_code ? strtoupper($request->currency_code) : null,
            'source'        => $request->source,
            'entity_name'   => $request->entity_name,
            'entity_type'   => $request->entity_type,
            'reason'        => $request->reason,
            'severity'      => $request->severity,
            'status'        => 'active',
            'list_date'     => now()->toDateString(),
        ]);

        return back()->with('success', 'Sanctioned address added successfully.');
    }

    public function revoke($id)
    {
        $entry = SanctionedAddress::findOrFail($id);
        $entry->update(['status' => 'revoked']);
        return back()->with('success', 'Entry revoked.');
    }

    public function delete($id)
    {
        $entry = SanctionedAddress::findOrFail($id);
        $entry->delete();
        return back()->with('success', 'Entry deleted.');
    }

    /**
     * Show AML screening logs.
     */
    public function logsIndex(Request $request)
    {
        $latestCases = AmlScreeningLog::query()
            ->with('screenable')
            ->whereIn('id', $this->latestCaseIdsQuery())
            ->get();

        $stats = [
            'total' => $latestCases->count(),
            'flagged' => $latestCases->whereIn('result', ['match', 'partial_match', 'error'])->count(),
            'resolved' => $latestCases->filter(fn (AmlScreeningLog $log) => $this->reviewState($log) !== 'needs_review')->count(),
            'wallet_reviews' => $latestCases
                ->whereIn('provider', ['wallet_screening', 'manual_wallet_review'])
                ->count(),
        ];

        $screenableTypes = [
            ExchangeRequest::class => 'Exchange',
            BuyRequest::class => 'Buy',
            SellRequest::class => 'Sell',
            CustodialDeposit::class => 'Custodial Deposit',
        ];

        $providerOptions = AmlScreeningLog::query()
            ->select('provider')
            ->whereNotNull('provider')
            ->distinct()
            ->orderBy('provider')
            ->pluck('provider')
            ->mapWithKeys(fn ($provider) => [$provider => $this->providerLabel($provider)])
            ->all();

        $providerReadiness = app(ExchangeAmlService::class)->providerReadiness();

        return view('admin.custodial.sanctions.logs', compact(
            'stats',
            'screenableTypes',
            'providerOptions',
            'providerReadiness'
        ));
    }

    public function logsList(Request $request)
    {
        $query = AmlScreeningLog::query()
            ->with('screenable')
            ->orderByDesc('checked_at')
            ->orderByDesc('id');

        if ($request->boolean('latest_only', true)) {
            $query->whereIn('id', $this->latestCaseIdsQuery());
        }

        if ($request->boolean('needs_review')) {
            $query->whereIn('result', ['match', 'partial_match', 'error']);
        }

        if ($request->filled('result')) {
            $query->where('result', $request->result);
        }

        if ($request->filled('provider')) {
            $query->where('provider', $request->provider);
        }

        if ($request->filled('screenable_type')) {
            $query->where('screenable_type', $request->screenable_type);
        }

        if ($request->filled('query')) {
            $search = trim((string) $request->input('query'));
            $query->where(function ($builder) use ($search) {
                $builder->where('address', 'like', '%' . $search . '%')
                    ->orWhere('matched_entity', 'like', '%' . $search . '%')
                    ->orWhere('matched_source', 'like', '%' . $search . '%')
                    ->orWhere('provider', 'like', '%' . $search . '%');
            });
        }

        return DataTables::of($query)
            ->addColumn('screenable_badge', function ($l) {
                $label = $this->screenableTypeLabel($l->screenable_type);

                return '<span class="badge bg-soft-info text-info">' . e($label) . '</span>';
            })
            ->addColumn('screenable_ref', function ($l) {
                return $this->screenableReference($l);
            })
            ->addColumn('address_short', function ($l) {
                $address = (string) $l->address;

                if (blank($address)) {
                    return '<span class="text-muted">-</span>';
                }

                $display = strlen($address) > 26
                    ? substr($address, 0, 12) . '...' . substr($address, -10)
                    : $address;

                return '<code class="small">' . e($display) . '</code>';
            })
            ->addColumn('provider_badge', function ($l) {
                return $this->providerBadge($l->provider);
            })
            ->addColumn('result_badge', function ($l) {
                return match ($l->result) {
                    'clean'         => '<span class="badge bg-soft-success text-success">Clean</span>',
                    'match'         => '<span class="badge bg-soft-danger text-danger">MATCH</span>',
                    'partial_match' => '<span class="badge bg-soft-warning text-warning">Partial</span>',
                    'error'         => '<span class="badge bg-soft-secondary text-body">Error</span>',
                    default         => '<span class="badge bg-soft-secondary text-body">' . $l->result . '</span>',
                };
            })
            ->addColumn('review_status_badge', function ($l) {
                return $this->reviewStatusBadge($l);
            })
            ->addColumn('risk_summary', function ($l) {
                $details = $this->screeningDetails($l);
                $parts = [];

                if ($l->risk_score !== null) {
                    $parts[] = 'Score: ' . rtrim(rtrim((string) $l->risk_score, '0'), '.');
                }

                if (!empty($details['risk_level'])) {
                    $parts[] = 'Level: ' . ucfirst((string) $details['risk_level']);
                }

                if (!empty($details['status'])) {
                    $parts[] = 'Decision: ' . ucfirst((string) $details['status']);
                }

                return empty($parts)
                    ? '<span class="text-muted">-</span>'
                    : e(implode(' · ', $parts));
            })
            ->addColumn('notes_preview', function ($l) {
                $details = $this->screeningDetails($l);
                $notes = $details['notes'] ?? $details['reason'] ?? $l->matched_entity ?? null;

                if (blank($notes)) {
                    return '<span class="text-muted">-</span>';
                }

                return e(Str::limit((string) $notes, 110));
            })
            ->addColumn('action', function ($l) {
                $url = $this->screenableUrl($l);

                if (!$url) {
                    return '<span class="text-muted small">No detail page</span>';
                }

                return '<a href="' . e($url) . '" class="btn btn-sm btn-outline-primary">Open</a>';
            })
            ->rawColumns([
                'screenable_badge',
                'screenable_ref',
                'address_short',
                'provider_badge',
                'result_badge',
                'review_status_badge',
                'risk_summary',
                'notes_preview',
                'action',
            ])
            ->make(true);
    }

    private function screenableTypeLabel(?string $screenableType): string
    {
        return match ($screenableType) {
            ExchangeRequest::class => 'Exchange',
            BuyRequest::class => 'Buy',
            SellRequest::class => 'Sell',
            CustodialDeposit::class => 'Custodial Deposit',
            default => class_basename((string) $screenableType),
        };
    }

    private function providerLabel(?string $provider): string
    {
        return match ($provider) {
            'internal_db' => 'Internal DB',
            'local_db' => 'Local DB',
            'ofac_api' => 'OFAC API',
            'wallet_screening' => 'Wallet Screening',
            'manual_wallet_review' => 'Manual Wallet Review',
            'manual_admin' => 'Manual Admin',
            null, '' => 'Unknown',
            default => Str::headline((string) $provider),
        };
    }

    private function providerBadge(?string $provider): string
    {
        $color = match ($provider) {
            'internal_db', 'local_db' => 'primary',
            'ofac_api' => 'warning',
            'wallet_screening' => 'info',
            'manual_wallet_review', 'manual_admin' => 'success',
            default => 'secondary',
        };

        return '<span class="badge bg-soft-' . $color . ' text-' . $color . '">'
            . e($this->providerLabel($provider))
            . '</span>';
    }

    private function screenableReference(AmlScreeningLog $log): string
    {
        $screenable = $log->screenable;
        $label = $this->screenableTypeLabel($log->screenable_type);
        $identifier = '#' . $log->screenable_id;

        if ($screenable) {
            $identifier = $screenable->utr
                ?? $screenable->tx_hash
                ?? $screenable->tx_id
                ?? ('#' . $log->screenable_id);
        }

        $url = $this->screenableUrl($log);
        $text = e($label . ' ' . $identifier);

        if (!$url) {
            return '<span>' . $text . '</span>';
        }

        return '<a href="' . e($url) . '" class="text-primary">' . $text . '</a>';
    }

    private function screenableUrl(AmlScreeningLog $log): ?string
    {
        $screenable = $log->screenable;

        if (!$screenable) {
            return null;
        }

        return match ($log->screenable_type) {
            ExchangeRequest::class => route('admin.exchangeView', ['id' => $screenable->id]),
            BuyRequest::class => route('admin.buyView', ['id' => $screenable->id]),
            SellRequest::class => route('admin.sellView', ['id' => $screenable->id]),
            CustodialDeposit::class => route('admin.custodialDepositIndex', ['highlight' => $screenable->id]),
            default => null,
        };
    }

    private function screeningDetails(AmlScreeningLog $log): array
    {
        return json_decode((string) $log->details, true) ?: [];
    }

    private function latestCaseIdsQuery()
    {
        return AmlScreeningLog::query()
            ->selectRaw('MAX(id)')
            ->groupBy('screenable_type', 'screenable_id', 'address');
    }

    private function reviewState(AmlScreeningLog $log): string
    {
        $screenable = $log->screenable;

        if ($screenable instanceof CustodialDeposit) {
            if ($screenable->isAmlRejected()) {
                return 'rejected';
            }

            if ($screenable->isAmlApproved()) {
                return 'approved';
            }
        }

        if (in_array($log->provider, ['manual_wallet_review', 'manual_admin'], true)) {
            return $log->result === 'clean' ? 'approved' : 'rejected';
        }

        if ($log->result === 'clean') {
            return 'approved';
        }

        return 'needs_review';
    }

    private function reviewStatusBadge(AmlScreeningLog $log): string
    {
        return match ($this->reviewState($log)) {
            'approved' => '<span class="badge bg-soft-success text-success">Resolved · Approved</span>',
            'rejected' => '<span class="badge bg-soft-danger text-danger">Resolved · Rejected</span>',
            default => '<span class="badge bg-soft-warning text-warning">Open Review</span>',
        };
    }

    /**
     * Import addresses from a CSV/text list.
     */
    public function import(Request $request)
    {
        $request->validate([
            'import_data' => 'required|string',
            'source'      => 'required|string|max:50',
            'severity'    => 'required|in:blocked,high_risk,monitor',
            'entity_name' => 'nullable|string|max:255',
            'reason'      => 'nullable|string|max:1000',
        ]);

        $lines = explode("\n", str_replace("\r\n", "\n", trim($request->import_data)));
        $imported = 0;
        $skipped = 0;

        foreach ($lines as $line) {
            $line = trim($line);
            if (empty($line) || str_starts_with($line, '#')) {
                continue;
            }

            // Parse: address,currency_code (optional)
            $parts = array_map('trim', explode(',', $line));
            $address = $parts[0] ?? '';
            $currencyCode = !empty($parts[1]) ? strtoupper($parts[1]) : null;

            if (empty($address)) {
                continue;
            }

            $normalized = SanctionedAddress::normalizeAddress($address);

            $created = SanctionedAddress::firstOrCreate(
                ['address' => $normalized, 'source' => $request->source],
                [
                    'currency_code' => $currencyCode,
                    'entity_name'  => $request->entity_name,
                    'entity_type'  => 'exchange',
                    'reason'       => $request->reason ?? 'Bulk import',
                    'severity'     => $request->severity,
                    'status'       => 'active',
                    'list_date'    => now()->toDateString(),
                ]
            );

            if ($created->wasRecentlyCreated) {
                $imported++;
            } else {
                $skipped++;
            }
        }

        return back()->with('success', "Imported: {$imported}, Skipped (duplicates): {$skipped}");
    }
}
