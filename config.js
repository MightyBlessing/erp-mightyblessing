/* 슈파베이스 연결 정보.
   Supabase 대시보드 → Project Settings → API 에서 두 값을 복사해 아래 따옴표 안에 넣는다.

     url      = Project URL          (https://xxxxxxxx.supabase.co 형태)
     anonKey  = anon public key      (publishable, 공개돼도 되는 키)

   anon key 는 브라우저에 그대로 실리도록 만들어진 공개 키다. 비밀 키(service_role)는
   절대 여기에 넣지 않는다.

   비워 두면 슈파베이스를 쓰지 않고, 클로드 아티팩트 안에서는 아티팩트 저장소로,
   그 밖에서는 데모 모드로 동작한다. */

window.MB_SUPABASE = {
  url: '',
  anonKey: ''
};
