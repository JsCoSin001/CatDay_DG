<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'username' => ['required', 'string'],
            'password' => ['required', 'string'],
        ]);

        $user = User::query()
            ->whereRaw('LOWER(username) = LOWER(?)', [$data['username']])
            ->where('is_active', 1)
            ->first();

        if (
            !$user ||
            empty($user->password_hash) ||
            !password_verify($data['password'], $user->password_hash)
        ) {
            return response()->json([
                'success' => false,
                'error_code' => 'AUTH_INVALID',
                'message' => 'Tên đăng nhập hoặc mật khẩu không đúng.',
            ], 422);
        }


        auth()->login($user, false);
        $request->session()->regenerate();

        return response()->json(['success' => true, 'csrf_token' => $request->session()->token(), 'user' => ['user_id' => $user->user_id, 'username' => $user->username, 'name' => $user->name]])->header('Cache-Control', 'no-store');
    }

    public function status(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !(bool) $user->is_active) {
            return response()->json(['success'=>false,'error_code'=>'AUTH_REQUIRED','message'=>'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.','csrf_token'=>$request->session()->token()], 401)->header('Cache-Control', 'no-store');
        }
        return response()->json(['success'=>true,'csrf_token'=>$request->session()->token(),'user'=>['user_id'=>$user->user_id,'username'=>$user->username,'name'=>$user->name]])->header('Cache-Control', 'no-store');
    }

    public function logout(Request $request): JsonResponse
    {
        auth()->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
        return response()->json(['success' => true, 'csrf_token' => $request->session()->token()])->header('Cache-Control', 'no-store');
    }
}
