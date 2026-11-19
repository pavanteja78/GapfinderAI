const BASE = import.meta.env.VITE_API ?? (import.meta.env.DEV ? "http://localhost:8000" : "");
export const getToken = () => localStorage.getItem("gf_token");
export const setToken = (t) => (t ? localStorage.setItem("gf_token", t) : localStorage.removeItem("gf_token"));

export async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...(opts.body && !isForm ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${getToken()}` },
    body: opts.body && !isForm ? JSON.stringify(opts.body) : opts.body,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const err = new Error(typeof e.detail === "string" ? e.detail : res.statusText);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
