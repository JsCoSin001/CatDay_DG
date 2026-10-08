<?php
namespace App\Http\Requests\B3;
class CutReelRequest extends B3Request{public function rules():array{return ['raw_qr'=>['required','string','max:2000'],'ke_hoach_id'=>['required','integer'],'ke_hoach_hang_id'=>['required','integer'],'group_id'=>['required','integer'],'detail_id'=>['required','integer'],'end_value'=>['nullable','integer'],'direction'=>['nullable','integer','in:-1,1'],'operation_token'=>['required','uuid']];}}
