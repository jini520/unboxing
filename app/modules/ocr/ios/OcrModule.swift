import ExpoModulesCore
import UIKit
import Vision

// 온디바이스 OCR (iOS = Apple Vision). 시뮬레이터·기기 모두 동작(ML Kit 의 device 전용 제약 회피 — ADR-036/D3).
// 이미지는 기기를 떠나지 않는다(파일 URI 로컬 읽기) — 텍스트만 반환(ADR-005·036).
public class OcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Ocr")

    // 이미지 URI(file://) → 한국어/영어 OCR 텍스트(읽기순서: 위→아래, 같은 줄은 왼→오).
    AsyncFunction("recognizeText") { (uri: URL, promise: Promise) in
      guard let data = try? Data(contentsOf: uri),
            let cgImage = UIImage(data: data)?.cgImage else {
        promise.reject("ERR_IMAGE", "이미지를 불러올 수 없습니다")
        return
      }
      let request = VNRecognizeTextRequest { req, error in
        if let error = error {
          promise.reject("ERR_VISION", error.localizedDescription)
          return
        }
        let observations = (req.results as? [VNRecognizedTextObservation]) ?? []
        let lines = observations
          .sorted { a, b in
            abs(a.boundingBox.midY - b.boundingBox.midY) > 0.012
              ? a.boundingBox.midY > b.boundingBox.midY  // boundingBox 원점이 좌하단 → midY 큰 게 위
              : a.boundingBox.minX < b.boundingBox.minX
          }
          .compactMap { $0.topCandidates(1).first?.string }
        promise.resolve(lines.joined(separator: "\n"))
      }
      request.recognitionLevel = .accurate
      request.recognitionLanguages = ["ko-KR", "en-US"]
      request.usesLanguageCorrection = true
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        } catch {
          promise.reject("ERR_VISION", error.localizedDescription)
        }
      }
    }
  }
}
