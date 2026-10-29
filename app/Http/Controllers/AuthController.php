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

    public function changePassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'new_password' => ['required', 'string', 'min:8', 'max:72', 'confirmed'],
        ], [
            'current_password.required' => 'Vui lòng nhập mật khẩu hiện tại.',
            'new_password.required' => 'Vui lòng nhập mật khẩu mới.',
            'new_password.min' => 'Mật khẩu mới cần có ít nhất 8 ký tự.',
            'new_password.max' => 'Mật khẩu mới không được vượt quá 72 ký tự.',
            'new_password.confirmed' => 'Xác nhận mật khẩu mới không khớp.',
        ]);

        // Bcrypt only uses the first 72 bytes; never accept a silently truncated password.
        if (strlen($data['new_password']) > 72) {
            return response()->json([
                'success' => false,
                'error_code' => 'PASSWORD_TOO_LONG',
                'message' => 'Mật khẩu mới không được vượt quá 72 byte.',
            ], 422)->header('Cache-Control', 'no-store');
        }

        /** @var User $user */
        $user = $request->user();
        if (!$user->password_hash || !password_verify($data['current_password'], $user->password_hash)) {
            return response()->json([
                'success' => false,
                'error_code' => 'PASSWORD_CURRENT_INVALID',
                'message' => 'Mật khẩu hiện tại không đúng.',
            ], 422)->header('Cache-Control', 'no-store');
        }
        if (password_verify($data['new_password'], $user->password_hash)) {
            return response()->json([
                'success' => false,
                'error_code' => 'PASSWORD_UNCHANGED',
                'message' => 'Mật khẩu mới phải khác mật khẩu hiện tại.',
            ], 422)->header('Cache-Control', 'no-store');
        }

        // Prevent concurrent updates from silently replacing a password already changed in another tab.
        $updated = User::query()
            ->whereKey($user->getAuthIdentifier())
            ->where('password_hash', $user->password_hash)
            ->update(['password_hash' => Hash::make($data['new_password'])]);
        if ($updated !== 1) {
            return response()->json([
                'success' => false,
                'error_code' => 'PASSWORD_CHANGED_ELSEWHERE',
                'message' => 'Mật khẩu đã thay đổi ở phiên khác. Vui lòng đăng nhập lại.',
            ], 409)->header('Cache-Control', 'no-store');
        }

        // Preserve the current login but rotate its session identifier and CSRF token.
        $request->session()->regenerate();
        return response()->json([
            'success' => true,
            'message' => 'Đổi mật khẩu thành công.',
            'csrf_token' => $request->session()->token(),
        ])->header('Cache-Control', 'no-store');
    }

    public function logout(Request $request): JsonResponse
    {
        auth()->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
        return response()->json(['success' => true, 'csrf_token' => $request->session()->token()])->header('Cache-Control', 'no-store');
    }
}
