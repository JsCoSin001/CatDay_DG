<?php

namespace App\Services\B3;

use App\Support\B3\B3Exception;

class CutCalculator
{
    public function firstCut(int $standardLength, int $cutLength, int $endValue, int $direction): array
    {
        if ($standardLength <= 0 || $cutLength <= 0 || !in_array($direction, [-1, 1], true)) {
            throw B3Exception::make('CUT_INPUT_INVALID', 'Dữ liệu cắt không hợp lệ.');
        }
        if ($cutLength > $standardLength) {
            throw B3Exception::make('INSUFFICIENT_LENGTH', 'Chiều dài còn lại của cuộn không đủ để thực hiện.', 409);
        }

        $soDauTruoc = $endValue - ($direction * $standardLength);
        $soCuoiTruoc = $endValue;
        $soDauCat = $soCuoiTruoc;
        $soCuoiCat = $soCuoiTruoc - ($direction * $cutLength);
        $soDauSau = $soDauTruoc;
        $soCuoiSau = $soCuoiCat;
        $this->assertNonNegativeMarkers(compact('soDauTruoc', 'soCuoiTruoc', 'soDauCat', 'soCuoiCat', 'soDauSau', 'soCuoiSau'));

        return compact('soDauTruoc', 'soCuoiTruoc', 'soDauCat', 'soCuoiCat', 'soDauSau', 'soCuoiSau') + [
            'heSoChieu' => $direction,
            'remainingLength' => abs($soCuoiSau - $soDauSau),
        ];
    }

    public function partialCut(int $soDau, int $soCuoi, int $cutLength): array
    {
        if ($cutLength <= 0 || $soDau === $soCuoi) {
            throw B3Exception::make('CUT_INPUT_INVALID', 'Dữ liệu cắt không hợp lệ.');
        }
        $actual = abs($soCuoi - $soDau);
        if ($cutLength > $actual) {
            throw B3Exception::make('INSUFFICIENT_LENGTH', 'Chiều dài còn lại của cuộn không đủ để thực hiện.', 409);
        }

        $h = $soDau < $soCuoi ? 1 : -1;
        $soDauTruoc = $soDau;
        $soCuoiTruoc = $soCuoi;
        $soDauCat = $soCuoiTruoc;
        $soCuoiCat = $soCuoiTruoc - ($h * $cutLength);
        $soDauSau = $soDauTruoc;
        $soCuoiSau = $soCuoiCat;
        $this->assertNonNegativeMarkers(compact('soDauTruoc', 'soCuoiTruoc', 'soDauCat', 'soCuoiCat', 'soDauSau', 'soCuoiSau'));

        return compact('soDauTruoc', 'soCuoiTruoc', 'soDauCat', 'soCuoiCat', 'soDauSau', 'soCuoiSau') + [
            'heSoChieu' => $h,
            'remainingLength' => abs($soCuoiSau - $soDauSau),
        ];
    }
    private function assertNonNegativeMarkers(array $markers): void
    {
        foreach ($markers as $value) {
            if ((int)$value < 0) {
                throw B3Exception::make('CUT_INPUT_INVALID', 'Lỗi - kiểm tra lại số cuối. Số đầu/số cuối sau tính toán phải lớn hơn hoặc bằng 0.');
            }
        }
    }

}
