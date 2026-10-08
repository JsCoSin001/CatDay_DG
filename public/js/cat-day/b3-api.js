(function (global) {
    'use strict';
    const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
    async function request(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            headers: {'Accept':'application/json','Content-Type':'application/json','X-CSRF-TOKEN':csrf(), ...(options.headers || {})},
            ...options,
        });
        let body = {};
        try { body = await response.json(); } catch (_) {}
        if (!response.ok || body.success === false) {
            const error = new Error(body.message || 'Không thể xử lý yêu cầu.');
            error.code = body.error_code || 'REQUEST_FAILED'; error.status = response.status; error.body = body; throw error;
        }
        return body;
    }
    const jsonPost = (url, data) => request(url,{method:'POST',body:JSON.stringify(data || {})});
    global.B3Api = {
        session: () => request('/api/b3/session'),
        login: (username,password) => jsonPost('/login',{username,password}),
        logout: () => jsonPost('/logout',{}),
        plans: (q='') => request('/api/b3/plans?q='+encodeURIComponent(q)),
        worklist: (planId) => request('/api/b3/plans/'+encodeURIComponent(planId)+'/worklist'),
        allWorklist: () => request('/api/b3/worklist'),
        resolveQr: (rawQr, planId=null) => jsonPost('/api/b3/scan/resolve',{raw_qr:rawQr,ke_hoach_id:planId}),
        takeWhole: (p) => jsonPost('/api/b3/execute/take-whole',p),
        cut: (p) => jsonPost('/api/b3/execute/cut',p),
    };
})(window);
