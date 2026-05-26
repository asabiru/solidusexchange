<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class BuyStoreRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        if ($this->method() == 'GET') {
            return [];
        }
        $rules = [
            'exchangeSendAmount' => 'required|numeric|min:0|not_in:0',
            'exchangeSendCurrency' => 'required|integer',
            'exchangeGetAmount' => 'required|numeric|min:0|not_in:0',
            'exchangeGetCurrency' => 'required|integer',
            'source_channel' => 'nullable|string|max:40',
            'fulfillment_method' => 'nullable|string|max:60',
        ];

        if ($this->routeIs('buyProcessing')) {
            $rules['user_agreement'] = 'required|accepted';
            $rules['payment_proof'] = 'nullable|file|mimes:jpg,jpeg,png,pdf,webp|max:10240';
        }

        return $rules;
    }
}
