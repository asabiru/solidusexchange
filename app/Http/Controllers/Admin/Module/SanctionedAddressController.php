<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Models\AmlScreeningLog;
use App\Models\SanctionedAddress;
use Illuminate\Http\Request;
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
    public function logsIndex()
    {
        return view('admin.custodial.sanctions.logs');
    }

    public function logsList(Request $request)
    {
        $query = AmlScreeningLog::query()->orderByDesc('id');

        if ($request->filled('result')) {
            $query->where('result', $request->result);
        }

        return DataTables::of($query)
            ->addColumn('result_badge', function ($l) {
                return match ($l->result) {
                    'clean'         => '<span class="badge bg-soft-success text-success">Clean</span>',
                    'match'         => '<span class="badge bg-soft-danger text-danger">MATCH</span>',
                    'partial_match' => '<span class="badge bg-soft-warning text-warning">Partial</span>',
                    'error'         => '<span class="badge bg-soft-secondary text-body">Error</span>',
                    default         => '<span class="badge bg-soft-secondary text-body">' . $l->result . '</span>',
                };
            })
            ->rawColumns(['result_badge'])
            ->make(true);
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
