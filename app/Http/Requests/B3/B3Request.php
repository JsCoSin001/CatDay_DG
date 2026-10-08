<?php
namespace App\Http\Requests\B3;

use App\Support\B3\B3Exception;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

abstract class B3Request extends FormRequest
{
    public function authorize(): bool { return auth()->check(); }
    protected function failedValidation(Validator $validator): void
    {
        throw B3Exception::make('VALIDATION_ERROR',$validator->errors()->first() ?: 'Dữ liệu gửi lên không hợp lệ.',422);
    }
}
