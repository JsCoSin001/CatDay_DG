<?php
namespace App\Http\Requests\B3;
class ResolveScanRequest extends B3Request{public function rules():array{return ['raw_qr'=>['required','string','max:2000'],'ke_hoach_id'=>['nullable','integer']];}}
