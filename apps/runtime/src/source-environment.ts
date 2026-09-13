import { parseSqliteQueryEnvironment,type SqliteQueryEnvironment } from "./sqlite-query-contract";
import { parseMqttEnvironment,type MqttEnvironment } from "./mqtt-environment";
import { AppError } from "../../api/src/auth";
import { validateConnectionUrl,type DataSource } from "../../api/src/data-sources";

export type SourceEnvironment = MqttEnvironment & SqliteQueryEnvironment & {
  version:1;
  endpoints:Record<string,{ projectIds:string[];url:string;credentialRef?:string }>;
  credentials:Record<string,{ headers:Record<string,string> }>;
};
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const invalid = () => new Error("Invalid source environment configuration; check its version, endpoints, project IDs and credential headers.");
const known = (value:Record<string,unknown>,fields:string[]) => Object.keys(value).every((key) => fields.includes(key));

/** Values stay in the server environment. Error text never interpolates secret input. */
export function parseSourceEnvironment(value:unknown):SourceEnvironment {
  if (!record(value) || !known(value,["version","endpoints","credentials","mqttEndpoints","mqttCredentials","sqliteQueries"]) || value.version !== 1 || !record(value.endpoints) || !record(value.credentials) || Object.keys(value.endpoints).length > 256 || Object.keys(value.credentials).length > 256) throw invalid();
  const endpoints:SourceEnvironment["endpoints"] = Object.create(null),credentials:SourceEnvironment["credentials"] = Object.create(null);
  for (const [ref,item] of Object.entries(value.credentials)) {
    if (!identifier.test(ref) || !record(item) || !known(item,["headers"]) || !record(item.headers) || Object.keys(item.headers).length > 16) throw invalid();
    const headers:Record<string,string> = Object.create(null);
    for (const [name,content] of Object.entries(item.headers)) {
      if (!/^[A-Za-z0-9-]{1,100}$/.test(name) || /^(?:host|connection|content-length|transfer-encoding|upgrade|accept|x-factory-twin-request-id|proxy-.*|sec-.*)$/i.test(name) || typeof content !== "string" || content.length > 8192 || /[^\x20-\x7e\x80-\xff]/.test(content) || Object.hasOwn(headers,name.toLowerCase())) throw invalid();
      headers[name.toLowerCase()] = content;
    }
    credentials[ref] = { headers };
  }
  for (const [ref,item] of Object.entries(value.endpoints)) {
    if (!identifier.test(ref) || !record(item) || !known(item,["url","projectIds","credentialRef"]) || typeof item.url !== "string" || item.url.length > 2048 || !Array.isArray(item.projectIds) || !item.projectIds.length || item.projectIds.length > 256 || !item.projectIds.every((id) => typeof id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(id))) throw invalid();
    let url:URL;
    try { url = new URL(validateConnectionUrl(item.url,["http:","https:","ws:","wss:"],"Environment endpoint")); }
    catch { throw invalid(); }
    if (item.credentialRef !== undefined && (typeof item.credentialRef !== "string" || !Object.hasOwn(credentials,item.credentialRef))) throw invalid();
    endpoints[ref] = { projectIds:[...new Set(item.projectIds)] as string[],url:url.toString(),...(item.credentialRef ? { credentialRef:item.credentialRef as string } : {}) };
  }
  return { version:1,endpoints,credentials,...parseMqttEnvironment(value),...parseSqliteQueryEnvironment(value) };
}

export function createSourceResolver(environment:SourceEnvironment) {
  const config = parseSourceEnvironment(environment);
  return (source:DataSource):{ url:string;headers:Record<string,string> } => {
    const ref = source.config.endpointRef;
    if (!ref) {
      if (source.config.credentialRef) throw new AppError(403,"credential_endpoint_required","Credentials require a server-bound logical endpoint.");
      return { url:source.config.url,headers:{} };
    }
    const endpoint = Object.hasOwn(config.endpoints,ref) ? config.endpoints[ref] : undefined;
    if (!endpoint || !endpoint.projectIds.includes(source.projectId)) throw new AppError(403,"source_endpoint_not_authorized","This logical endpoint is unavailable to the project in this environment.");
    if (source.config.credentialRef && endpoint.credentialRef !== source.config.credentialRef) throw new AppError(403,"source_credential_not_authorized","The credential reference does not match the bound endpoint.");
    const protocol = new URL(endpoint.url).protocol;
    if (!(source.sourceType === "rest_polling" ? ["http:","https:"] : ["ws:","wss:"]).includes(protocol)) throw new AppError(409,"source_endpoint_protocol_mismatch","Logical endpoint protocol does not match the source type.");
    return { url:endpoint.url,headers:endpoint.credentialRef ? { ...config.credentials[endpoint.credentialRef].headers } : {} };
  };
}
