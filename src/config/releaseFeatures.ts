/**
 * v1.2.0 Play 제출 범위는 보호자·아이 모드다.
 * 선생님 모드는 심사 문서·계정·역할별 E2E가 준비될 때 별도 코드 변경과 검증으로 연다.
 * 배포 환경변수만으로 우회하지 않아 출시 산출물의 범위를 고정한다.
 */
export const TEACHER_MODE_ENABLED = import.meta.env.DEV;
