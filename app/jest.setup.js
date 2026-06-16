// 커뮤니티 모듈 AsyncStorage 는 jest-expo preset이 자동 mock하지 않는다.
// cache.ts 의 운영 어댑터(cacheStore)가 top-level import로 네이티브 모듈을 로드해
// 테스트에서 크래시하므로, 공식 인메모리 mock을 모든 테스트 로드 전에 등록한다.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
