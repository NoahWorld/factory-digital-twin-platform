import { AppError } from "../../api/src/auth";
import { validateConnectionUrl,validateMqttTopic,type DataSource } from "../../api/src/data-sources";
export type MqttEnvironment = {
  mqttEndpoints?:Record<string,{ projectIds:string[];url:string;topics:string[];credentialRef?:string }>;
  mqttCredentials?:Record<string,{ username:string;password:string }>;
};
const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const invalid = ():never => { throw new Error("Invalid private MQTT environment configuration."); };
export function parseMqttEnvironment(value:Record<string,unknown>):MqttEnvironment {
  const endpoints = value.mqttEndpoints ?? {},credentials = value.mqttCredentials ?? {};
  if (!record(endpoints) || !record(credentials) || Object.keys(endpoints).length>256 || Object.keys(credentials).length>256) return invalid();
  const mqttEndpoints:NonNullable<MqttEnvironment["mqttEndpoints"]> = Object.create(null),mqttCredentials:NonNullable<MqttEnvironment["mqttCredentials"]> = Object.create(null);
  for (const [id,item] of Object.entries(credentials)) {
    if (!identifier.test(id) || !record(item) || Object.keys(item).some((key) => !["username","password"].includes(key)) || typeof item.username !== "string" || !item.username || item.username.length>256 || /[\u0000-\u001f\u007f]/.test(item.username) || typeof item.password !== "string" || item.password.length>8192) return invalid();
    mqttCredentials[id] = { username:item.username,password:item.password };
  }
  for (const [id,item] of Object.entries(endpoints)) {
    if (!identifier.test(id) || !record(item) || Object.keys(item).some((key) => !["url","projectIds","topics","credentialRef"].includes(key)) || !Array.isArray(item.projectIds) || !item.projectIds.length || item.projectIds.length>256 || !item.projectIds.every((id) => typeof id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(id)) || !Array.isArray(item.topics) || !item.topics.length || item.topics.length>256) return invalid();
    let url:URL,topics:string[];
    try { url = new URL(validateConnectionUrl(item.url,["mqtt:","mqtts:"],"MQTT environment"));topics = item.topics.map(validateMqttTopic); } catch { return invalid(); }
    if (!url.hostname || !["","/"].includes(url.pathname) || url.search || url.hash) return invalid();
    if (!url.port) url.port = url.protocol === "mqtts:" ? "8883":"1883";
    if (item.credentialRef !== undefined && (typeof item.credentialRef !== "string" || !Object.hasOwn(mqttCredentials,item.credentialRef))) return invalid();
    mqttEndpoints[id] = { projectIds:[...new Set(item.projectIds)] as string[],url:url.toString(),topics:[...new Set(topics)],...(item.credentialRef ? { credentialRef:item.credentialRef as string }:{}) };
  }
  return { ...(value.mqttEndpoints !== undefined ? { mqttEndpoints }:{}),...(value.mqttCredentials !== undefined ? { mqttCredentials }:{}) };
}
export function createMqttResolver(environment:MqttEnvironment) {
  const config = parseMqttEnvironment(environment as Record<string,unknown>);
  return (source:DataSource):{ url:string;username?:string;password?:string } => {
    if (source.sourceType !== "mqtt" || !("topic" in source.config)) throw new AppError(409,"runtime_source_not_supported","An MQTT source is required.");
    const endpoint = config.mqttEndpoints?.[source.config.endpointRef];
    if (!endpoint || !endpoint.projectIds.includes(source.projectId)) throw new AppError(403,"source_endpoint_not_authorized","MQTT endpoint is unavailable to this project.");
    if (!endpoint.topics.includes(source.config.topic)) throw new AppError(403,"mqtt_topic_not_authorized","MQTT topic is unavailable to this project endpoint.");
    if (source.config.credentialRef && source.config.credentialRef !== endpoint.credentialRef) throw new AppError(403,"source_credential_not_authorized","MQTT credential reference does not match the bound endpoint.");
    return { url:endpoint.url,...(endpoint.credentialRef ? config.mqttCredentials![endpoint.credentialRef]:{}) };
  };
}
