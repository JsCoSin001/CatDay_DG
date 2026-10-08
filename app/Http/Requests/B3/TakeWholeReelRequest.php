<?php
namespace App\Http\Requests\B3;
class TakeWholeReelRequest extends B3Request{public function rules():array{return ['raw_qr'=>['required','string','max:2000'],'ke_hoach_id'=>['required','integer'],'ke_hoach_hang_id'=>['required','integer'],'operation_token'=>['required','uuid']];}}
