package expo.modules.ocr

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// 온디바이스 OCR (Android = ML Kit 한국어). 이미지 URI(file://) → 텍스트(ML Kit 가 읽기순서 반환).
// 이미지는 기기를 떠나지 않는다 — 텍스트만 반환(ADR-005·036).
class OcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Ocr")

    AsyncFunction("recognizeText") { uri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("ERR_CONTEXT", "No React context", null)
        return@AsyncFunction
      }
      try {
        val image = InputImage.fromFilePath(context, Uri.parse(uri))
        val recognizer = TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
        recognizer.process(image)
          .addOnSuccessListener { result -> promise.resolve(result.text) }
          .addOnFailureListener { e -> promise.reject("ERR_MLKIT", e.message, e) }
      } catch (e: Exception) {
        promise.reject("ERR_MLKIT", e.message, e)
      }
    }
  }
}
