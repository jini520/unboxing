import OcrModule from './src/OcrModule';

/**
 * 온디바이스 OCR — iOS Apple Vision / Android ML Kit(한국어). 이미지 URI(file://) → 읽기순서 텍스트.
 * 이미지·원문은 기기를 떠나지 않는다(ADR-005·036) — 호출부가 maskPurchaseText 후 마스킹 텍스트만 전송.
 */
export function recognizeText(uri: string): Promise<string> {
  return OcrModule.recognizeText(uri);
}
