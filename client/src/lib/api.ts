import axios from "axios";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const api = axios.create({
  baseURL: "",
});

api.interceptors.request.use(async (config) => {
  if (typeof window !== "undefined") {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

export default api;
