import "server-only";
// 모듈 전용 read-only facade. setSetting/listSettings 미노출.
export { getSetting, getSmtpConfig } from "./service";
// getSetting이 던지는 도메인 에러를 모듈이 instanceof로 구분할 수 있도록 노출한다.
// (task-06 safe()가 "무효 저장값"과 "인프라 장애"를 구분하는 데 필요. 경계 가드상 모듈은
//  @/kernel/settings/reader만 import하므로 이 에러도 reader를 통해서만 닿게 한다.)
export { SettingInvalidError } from "./registry";
