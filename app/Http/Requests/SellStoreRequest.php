<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class SellStoreRequest extends FormRequest
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
        return [
            'exchangeSendAmount' => 'required|numeric|min:0|not_in:0',
            'exchangeSendCurrency' => 'required|integer',
            'exchangeGetAmount' => 'required|numeric|min:0|not_in:0',
            'exchangeGetCurrency' => 'required|integer',
        ];
    }
}
