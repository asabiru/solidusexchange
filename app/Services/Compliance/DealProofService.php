<?php

namespace App\Services\Compliance;

use App\Models\DealProof;
use App\Traits\Upload;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

class DealProofService
{
    use Upload;

    public function storeFromRequest(Request $request, Model $proofable, string $field = 'payment_proof'): ?DealProof
    {
        if (!$request->hasFile($field)) {
            return null;
        }

        $file = $this->fileUpload($request->file($field), 'deal-proofs');

        $proof = DealProof::create([
            'proofable_type' => $proofable::class,
            'proofable_id' => $proofable->getKey(),
            'uploaded_by_id' => auth()->id(),
            'uploaded_by_type' => 'user',
            'proof_type' => (string) $request->input('proof_type', 'payment_receipt'),
            'file_path' => $file['path'] ?? null,
            'file_driver' => $file['driver'] ?? null,
            'notes' => $request->input('proof_notes'),
        ]);

        app(AuditLogService::class)->record('deal_proof_uploaded', $proofable, [
            'proof_id' => $proof->id,
            'proof_type' => $proof->proof_type,
        ], [], [], $request);

        return $proof;
    }
}
