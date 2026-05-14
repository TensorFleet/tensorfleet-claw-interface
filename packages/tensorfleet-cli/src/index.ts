
export { version } from '../package.json';
export {
  TENSORFLEET_AUTH_GLOBAL_KEY,
  getGlobalAuthInfo,
  storeAuthTokenOnGlobal,
  storeProjectAuthInfoOnGlobal,
  type TensorfleetGlobalAuthInfo,
} from "./auth-global";
