(function (global) {
    'use strict';
    let authGeneration = 0;
    const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
    function syncCsrf(response, body, generation) {
        if (generation !== authGeneration) return;
        const token = body.csrf_token || response.headers?.get('X-CSRF-TOKEN');
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (typeof token === 'string' && token && meta) meta.content = token;
    }
    async function request(url, options = {}) {
        const generation = authGeneration;
        const response = await fetch(url, {
            credentials: 'same-origin',
            headers: {'Accept':'application/json','Content-Type':'application/json','X-CSRF-TOKEN':csrf(), ...(options.headers || {})},
            ...options,
        });
        let body = {};
        try { body = await response.json(); } catch (_) {}
        const authChanged = response.ok && body.success !== false && (url === '/login' || url === '/logout' || url === '/api/account/password');
        if (authChanged) authGeneration++;
        syncCsrf(response, body, authChanged ? authGeneration : generation);
        if (!response.ok || body.success === false) {
            const error = new Error(body.message || 'Không thể xử lý yêu cầu.');
            error.code = body.error_code || 'REQUEST_FAILED'; error.status = response.status; error.body = body;
            if (error.status === 419 && url !== '/api/b3/session' && generation === authGeneration) {
                // CSRF middleware runs before auth: a lost session can also surface as 419.
                // Check authentication with one read, preserving the original error and never replaying the write.
                try { await request('/api/b3/session'); }
                catch (sessionError) {
                    if (sessionError.sessionExpired) error.sessionExpired = true;
                }
            }
            if ((error.status === 401 || ['AUTH_REQUIRED', 'USER_INACTIVE'].includes(error.code)) && generation === authGeneration) {
                // Responses from a previous login or an already-expired session cannot reset the current UI.
                authGeneration++;
                error.sessionExpired = true;
                if (typeof global.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                    global.dispatchEvent(new CustomEvent('b3:session-expired', {
                        detail: {code: error.code, status: error.status, message: error.message},
                    }));
                }
            }
            throw error;
        }
        return body;
    }
    const jsonPost = (url, data) => request(url,{method:'POST',body:JSON.stringify(data || {})});
    global.B3Api = {
        session: () => request('/api/b3/session'),
        login: async (username,password) => {
            // Another tab may have rotated the shared session token. Refresh once before explicit login.
            try { await request('/api/b3/session'); }
            catch (error) {
                if (error.status !== 401 && error.code !== 'USER_INACTIVE') throw error;
            }
            return jsonPost('/login',{username,password});
        },
        logout: () => jsonPost('/logout',{}),
        changePassword: (currentPassword, newPassword, confirmation) => jsonPost('/api/account/password', {
            current_password: currentPassword,
            new_password: newPassword,
            new_password_confirmation: confirmation,
        }),
        plans: (q='') => request('/api/b3/plans?q='+encodeURIComponent(q)),
        worklist: (planId) => request('/api/b3/plans/'+encodeURIComponent(planId)+'/worklist'),
        allWorklist: () => request('/api/b3/worklist'),
        resolveQr: (rawQr, planId=null) => jsonPost('/api/b3/scan/resolve',{raw_qr:rawQr,ke_hoach_id:planId}),
        takeWhole: (p) => jsonPost('/api/b3/execute/take-whole',p),
        cut: (p) => jsonPost('/api/b3/execute/cut',p),
        cutSession: (p) => request('/api/b3/cut-session?'+Object.entries(p).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&')),
    };
})(window);
