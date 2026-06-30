import { NativeModule, requireNativeModule } from 'expo';

declare class OcrModule extends NativeModule<{}> {
  /** 이미지 URI(file://) → 한국어/영어 OCR 텍스트(읽기순서 보존). */
  recognizeText(uri: string): Promise<string>;
}

export default requireNativeModule<OcrModule>('Ocr');
