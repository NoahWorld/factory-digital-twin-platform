/** Package environment references cover network endpoints and registered database queries. */
export const sourceEnvironmentRef = (source:{ sourceType:string;config:{ endpointRef?:string;queryRef?:string } }):string|undefined => source.sourceType === "sqlite_query" ? source.config.queryRef:source.config.endpointRef;
