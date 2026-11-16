/* 슈파베이스 연결 정보.
   Supabase 대시보드 → Project Settings → API Keys / Data API 에서 복사한 값.

     url      = Project URL     (https://xxxxxxxx.supabase.co)
     anonKey  = Publishable key (sb_publishable_... · 공개돼도 되는 키)

   Publishable 키는 브라우저에 그대로 실리도록 만들어진 공개 키다.
   Secret 키(sb_secret_... / service_role)는 RLS를 전부 무시하므로 절대 여기 넣지 않는다. */

window.MB_SUPABASE = {
  url: 'https://ykyuhuhhxnlhbfjiuihv.supabase.co',
  anonKey: 'sb_publishable_-HlFBy_k2K8KMIXu5gpyfg_Yq6Z20iQ'
};
