import { registerWebModule, NativeModule } from 'expo';

class OcrModule extends NativeModule<{}> {
  // 웹은 온디바이스 OCR 미지원 — 캡처 기능은 iOS/Android 전용(웹은 직접 입력만).
  async recognizeText(_uri: string): Promise<string> {
    throw new Error('OCR is not supported on web');
  }
}

export default registerWebModule(OcrModule, 'OcrModule');
