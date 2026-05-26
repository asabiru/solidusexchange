<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;

class BaseRequest extends FormRequest
{
    protected function failedValidation(Validator $validator)
    {
        throw new HttpResponseException($this->buildResponse($validator));
    }

    protected function buildResponse($validator)
    {
        if ($this->expectsJson()) {
            return response()->json([
                'status' => 'failed',
                'errors' => $validator->errors(),
            ], JsonResponse::HTTP_UNPROCESSABLE_ENTITY);
        }

        return redirect($this->getRedirectUrl())
            ->withInput($this->input())
            ->withErrors($validator);
    }
}
