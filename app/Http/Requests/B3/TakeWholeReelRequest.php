<?php
namespace App\Http\Requests\B3;
class TakeWholeReelRequest extends B3Request{public function rules():array{return ['raw_qr'=>['required','string','max:2000'],'ke_hoach_id'=>['required','integer'],'ke_hoach_hang_id'=>['required','integer'],'quy_cach_cuon_chan_id'=>['required','integer','min:1'],'operation_token'=>['required','uuid']];}}
