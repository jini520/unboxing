/**
 * 구매 캡처 분석 파이프라인 ①② — 이미지 선택(expo-image-picker) + 온디바이스 OCR(iOS Apple Vision / Android ML Kit, 한국어).
 * 결정: docs/ADR.md ADR-036(온디바이스 OCR·이미지 기기이탈 금지)·038(마스킹은 호출부에서) / docs/ARCHITECTURE.md "v1.1.2".
 *
 * CRITICAL(ADR-036·005): 이미지·OCR 원문은 **기기를 떠나지 않는다** — 이 모듈은 텍스트만 반환하고,
 *   호출부(shipment/[id].tsx)가 maskPurchaseText 로 PII 를 제거한 **마스킹 텍스트만** 외부(/classify-purchase)로 보낸다.
 * 네이티브 경계(이미지 picker·OCR 모듈)라 순수 로직이 없다 → jest 단위테스트 대상 아님(coverage 제외, push.ts 패턴).
 *   실 동작 검증은 외부 경계 스모크(step 4)에서. mock verify green 은 이 경계를 보증하지 않는다(docs/ENGINEERING.md).
 */
import * as ImagePicker from "expo-image-picker";
import { recognizeText } from "../../modules/ocr";

/**
 * 캡처 결과 — 호출부가 분기한다.
 *  - ok: OCR 텍스트(읽기순서). 이 텍스트는 아직 마스킹 전 → 호출부가 maskPurchaseText 후 전송.
 *  - canceled: 사용자가 이미지 선택을 취소(조용히 무시).
 *  - empty: 이미지는 골랐으나 OCR 0줄("인식 실패, 다시 촬영" 폴백).
 */
export type CaptureResult =
  | { kind: "ok"; text: string }
  | { kind: "canceled" }
  | { kind: "empty" };

/**
 * 사진 라이브러리에서 주문 상세 스크린샷 1장을 골라 한국어 OCR 로 텍스트를 추출한다.
 * 실패(picker·OCR throw)는 그대로 던져 호출부가 "직접 입력" 폴백(흐름 안 멈춤, ADR-039).
 *
 * @param opts.onImagePicked picker 가 uri 를 반환한 직후·OCR(recognizeText) 전에 1회 호출.
 *   호출부가 진행률 램프·오버레이를 **사진 선택 시점(=OCR 시작)** 부터 켜기 위함(ADR-045 개정 2 —
 *   picker 여는 동안 램프가 돌아 사진 선택 시점에 이미 % 가 올라가 있던 버그 수정). 취소 시 미발화.
 */
export async function capturePurchaseText(opts?: {
  onImagePicked?: () => void;
}): Promise<CaptureResult> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 1,
  });
  const uri = picked.canceled ? undefined : picked.assets?.[0]?.uri;
  if (!uri) return { kind: "canceled" };

  opts?.onImagePicked?.(); // 사진 선택 직후·OCR 전 — 진행률 램프 시작 신호(ADR-045 개정 2)

  // 온디바이스 OCR(iOS Apple Vision / Android ML Kit·한국어). 이미지 URI 는 기기 로컬 — 외부 전송 없음(ADR-036).
  const text = (await recognizeText(uri)).trim();
  if (!text) return { kind: "empty" };
  return { kind: "ok", text };
}
