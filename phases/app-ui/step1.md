# Step 1: device-identity (device_id 생성·보관)

익명 인증의 토대. 고엔트로피 secret `device_id` 를 생성해 보안 저장소(Keychain/Keystore)에 보관하고 재사용한다. test-first 가능한 순수 부분 + SecureStore 어댑터.

## 읽어야 할 파일

- **https://docs.expo.dev/versions/v56.0.0/sdk/securestore/** · **/sdk/crypto/** — SDK 56 expo-secure-store·expo-crypto API
- `/docs/ARCHITECTURE.md` — "디바이스 식별 & 인증/인가"
- `/docs/ADR.md` — ADR-007(secret device_id Bearer), ADR-002(익명)
- `/Users/jinni/Developments/unboxing/app/src/lib/tracking.ts` — 기존 lib 코드 스타일
- `/Users/jinni/Developments/unboxing/app/src/lib/tracking.test.ts` — 테스트 스타일(`@jest/globals`)
- step0 산출물: `app/src/config.ts`, `app/src/theme/`

## 작업

`app/src/lib/device.ts` 와 `app/src/lib/device.test.ts`.

```ts
/** 보안 저장소 추상화(테스트 주입용). 운영 구현은 expo-secure-store. */
export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

/** ≥128bit 랜덤 → base64url 등 안전한 문자열. randomBytes 주입(expo-crypto). */
export function generateDeviceId(randomBytes: (n: number) => Uint8Array): string;

/** 저장소에 있으면 반환, 없으면 생성·저장 후 반환(멱등). */
export function getDeviceId(deps: { storage: SecureStorage; randomBytes: (n: number) => Uint8Array }): Promise<string>;

/** 운영용 기본 인스턴스(expo-secure-store + expo-crypto). */
export const deviceStorage: SecureStorage;
```

## 핵심 규칙 (벗어나면 안 됨)

- device_id 는 **≥128bit 엔트로피**. 이유: 추측 불가한 비밀이 곧 자격(ADR-007).
- **SecureStore(Keychain/Keystore-backed)에 저장**한다. AsyncStorage(평문)에 저장 금지. 이유: ADR-007 보안 저장.
- **한 번 생성되면 재사용**(멱등). 매 호출 새로 만들지 마라. 이유: 같은 기기는 같은 구독 소유권.
- device_id 를 **로그에 남기지 마라.** 이유: ADR-007.

## 테스트 (test-first, 인메모리 SecureStorage)

- `generateDeviceId` 결과 길이/엔트로피(≥16바이트 인코딩) 검증, 호출마다 다른 값(주입 randomBytes로 결정적 검증).
- `getDeviceId`: 비어 있으면 생성·저장(setItem 호출), 두 번째 호출은 저장값 재사용(생성 안 함).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트: ≥128bit인가? SecureStore 사용(AsyncStorage 아님)인가? 멱등 재사용이 테스트로 보장되는가? device_id 로그 부재?
3. `phases/app-ui/index.json` 의 step 1 업데이트(규칙은 step0 동일).

## 금지사항

- device_id 를 AsyncStorage·env·일반 파일에 저장하지 마라. 이유: 평문 노출, ADR-007 위반.
- 매 호출마다 새 device_id 를 생성하지 마라. 이유: 소유권 단절(구독 유실).
- device_id 를 `console.log` 등에 출력하지 마라. 이유: 민감값.
- 기존 테스트를 깨뜨리지 마라.
