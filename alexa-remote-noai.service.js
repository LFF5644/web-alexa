const svr=this; // service object
const v=rtjscomp.verbose&&rtjscomp.verbose.includes("web/alexa/alexa-remote");

svr.cfg={};
svr.accounts={};

svr.started=false;

const ALEXA_OPTS = {
	//autoQueryActivityOnTrigger: true, // bei jedem Trigger automatisch den Transkript-Text holen (alt)
	acceptLanguage: 'de-DE',
	alexaServiceHost: 'alexa.amazon.de',
	amazonPage: 'amazon.de',
	bluetooth: false,
	logger: () => {},
	proxyLogLevel: "warn",
	proxyOnly: true,
	proxyOwnIp: "127.0.0.1",
	proxyPort: 8080,
	useWsMqtt: true, // Push-Verbindung an
};

const create_account_template=id=>({
	alexa: new Alexa(),
	cookie: null,
	entities: [],
	entityIds: [],
	id,
	ready: false,
});

let interval_save=0; const INTERVAL_MS_SAVE=svr.cfg.INTERVAL_MS_SAVE || 1e3*60*3;

const Alexa=require("alexa-remote2");

const load=async()=>{
	const loaded_config=await rtjscomp.data_load("alexa/config.json")
	if(!loaded_config) throw "ERROR: CONFIG: alexa/config.json not exists! CREATE IT FIRST xD";
	Object.assign(svr.cfg, loaded_config);
	
	if(svr.cfg.ALEXA_OPTS) Object.assign(ALEXA_OPTS, svr.cfg.ALEXA_OPTS);
	
	log("Lade Accounts: "+svr.cfg.accountIds.join(", ")+" ...");
	for(const accountId of svr.cfg.accountIds){
		let account=undefined;
		if(hasAccount(accountId)){
			log("loading and modifying account: "+accountId);
			account=Object.assign(getAccount(accountId),{
				cookie: await rtjscomp.data_load("alexa/account_"+accountId+"/secret_cookie.json"),
			});
		}
		else{

			// TODO Check if "alexa/account_xx" not exists, so program dont have to crash xD
			svr.accounts[accountId]={
				...create_account_template(accountId),
				cookie: await rtjscomp.data_load("alexa/account_"+accountId+"/secret_cookie.json"),
			}
			account=getAccount(accountId);
		}
	}
}
const save=async()=>{
	for(const accountId of svr.cfg.accountIds){
		const account=getAccount(accountId);
		//if(!account.ready) continue;
		if(account.alexa&&account.alexa.cookieData){
			log("account: "+accountId+" checking for alexa.cookie");
			if(JSON.stringify(account.alexa.cookieData)!==JSON.stringify(account.cookie)){
				log("Save: Account Cookie von "+accountId+" geändert, speichere...");
				await rtjscomp.data_save("alexa/account_"+accountId+"/secret_cookie.json",account.alexa.cookieData);
				log("Datei: "+"alexa/account_"+accountId+"/secret_cookie.json"+" wurde GESPEICHERT.");
				Object.assign(account.cookie,account.alexa.cookieData);
			}
			else log("not saving cookie, nothing changed: "+accountId);
		}
		else log("not saving account cookieData, because not exists for acc: "+accountId);
	}
};
const throw_error=message=>{throw message; return false}
const getAccount=accountId=>svr.accounts[accountId]||throw_error("accountId not exists: "+accountId);
const hasAccount=accountId=>svr.accounts[accountId]!==undefined;
const getAccountEntity=(accountId,entityId)=>getAccount(accountId).entities.find(entity=>entity.id===entityId)||throw_error("account "+accountId+" dont have entity "+entityId);
const hasAccountEntity=(accountId,entityId)=>getAccount(accountId).entities.find(entity=>entity.id===entityId)!==undefined;
const filterAccountEntityByData=(accountId,entityDataNamespace)=>getAccount(accountId).entities.filter(entity=>entity.data.has(entityDataNamespace)).map(item=>item.id);
const findEntity=entityId=>Object.keys(svr.accounts).map(item=>item[1].entities).map(accEnt=>accEnt.find(item=>item.id===entityId)).filter(Boolean)[0]||throw_error("entityId dont exists in any accounts: "+entityId);
const refreshEntitiesFullStructure=async accountId=>{
	const account=getAccount(accountId);
	log("Update aller Identitäten & Geräten für "+accountId+" ...");
	if(!await new Promise(resolve=>account.alexa.getSmarthomeEntities((err,entries)=>{
		if(err) return resolve(log("Fehler refreshEntitiesFullStructure getSmarthomeEntities bei "+accountId+"! "+err.message) || console.error(err) && false);
		if(!(entries&&entries.length)||!Array.isArray(entries)) return resolve(log("Fehler getSmarthomeEntities gibt kein gültiges Array oder Leeres Array zurück")&&false);
		log("Durchsuche "+entries.length+" Entities ...");
		for(const entry of entries){
			//console.log("SmarthomeEntry:",entry);
			const entry_new={
				availability: entry.availability,
				data: new Map(),
				description: entry.description,
				deviceType: entry.providerData.deviceType,
				displayName: entry.displayName,
				id: entry.id,
				supportedOperations: entry.supportedOperations||[],
				supportedProperties: entry.supportedProperties||[],
			};
			if(hasAccountEntity(accountId,entry.id)){
				log("update entity: "+accountId+", "+entry_new.displayName);
				Object.assign(getAccountEntity(accountId,entry.id),entry_new);
			}
			else{
				log("new entity: "+accountId+", "+entry_new.displayName);
				account.entities.push(entry_new);
				account.entityIds.push(entry_new.id);
			}
			//console.log("SmarthomeEntry SERVICE OBJECT:",entry_new);
		}

		resolve(true);
	}))) return log("Abbruch von refreshEntitiesFullStructure für Account "+accountId);

	if(!await new Promise(resolve=>account.alexa.querySmarthomeDevices(account.entityIds, 'ENTITY',(err,entriesData)=>{
		if(err) return resolve(log("Fehler refreshEntitiesFullStructure querySmarthomeDevices bei "+accountId+"! "+err.message)||console.error(err)&&false);
		//console.log(JSON.stringify(entriesData.deviceStates,null,2));

		for(const item of entriesData.deviceStates){
			if(!hasAccountEntity(accountId,item.entity.entityId)){log("entity not exits: "+item.entity.entityId);continue}
			const entity=getAccountEntity(accountId,item.entity.entityId);

			if(item.entity.entityType!=="ENTITY"){log("NOT AN ENTITY WTF"); continue}
			if(!item.capabilityStates){log("Entity dont have capabilityStates"); continue}
			const now=Date.now();
			for(let state of item.capabilityStates){
				try{state=JSON.parse(state);}catch(e){log("cant parse entity.capabilityStates[x] to JSON!");continue}
				//console.log(state);
				let namespace=state.namespace; // namespace: 'Alexa.PowerController' --> "PowerController"
				if(namespace.startsWith("Alexa.")) namespace=namespace.substring("Alexa.".length); // Removes "Alexa." at start because stupid xD
				if(namespace.includes(".")) namespace=namespace.split(".").join(""); // Removes strange dots
				const name=state.name;
				let value=state.value;
				//value=JSON.parse(value);
				const keys=Object.keys(value);
				if(keys.length===1){ // { value: 'OK' } --> "OK"
					value=value[keys[0]];
				}
				// SET entity.data.TemperatureSensor.temperature == { value: 29.8, scale: 'CELSIUS' }
				if(entity.data.has(namespace)){
					Object.assign(entity.data.get(namespace),{
						[name]: value,
					});
				}
				else{
					entity.data.set(namespace,{[name]:value});
				}
			}
			entity.data.lastDataFetch=now;
			//console.log(entity);

		}
		resolve(true);
	}))) return log("Abbruch von refreshEntitiesFullStructure für Account "+accountId);

	console.log("OK")

}

const start=()=>{
	for(const accountId of svr.cfg.accountIds){
		const account=getAccount(accountId);
		if(account.ready){log("account "+accountId+" is still ready not starting once more, stop first!");continue}
		account.ready=false;

		log("Start: Verbinde Amazon Account "+accountId+" ...");
		try{
			account.alexa.init({
				...ALEXA_OPTS,
				cookie: {...account.cookie}, // MAYBE FIXING SAVE ISSUS
			},(err)=>onAlexaAccountConnected(accountId,err));
		}catch(e){
			log("Start: Verbindung mit Account '"+accountId+"' nicht möglich, ALEXA.INIT Start Fehler: "+(e.message||e));
			account.ready=false;
		}

	}
	svr.started=true;
	if(interval_save) clearInterval(interval_save);
	interval_save=setInterval(save,INTERVAL_MS_SAVE);
}
const stop=()=>{
	if(!svr.started) log("stop: WARNUNG Service nicht richtig gestartet, FORCE STOP...");
	log("stopping...");
	clearInterval(interval_save); interval_save=0; save(); // Save & Disable Autosave!
	svr.started=false;
	
	for(const accountId of svr.cfg.accountIds){
		const account=getAccount(accountId);
		//if(!account.ready) continue;
		log("stoppe alexa für account "+accountId);
		try{
			account.alexa.stop();
		}catch(err){
			log("stop: Fehler Account "+accountId+" kann nicht heruntergefahren werden: "+err.message);
			console.error(err);
		}finally{
			account.ready=false;
		}
		//delete account;
	}
	//delete svr.cfg;
	//delete svr.accounts;
	save();
	log("stop: ende");
}
const onAlexaAccountConnected=async (accountId,err)=>{
	const account=getAccount(accountId);
	if(err) return log("Verbindung mit Account '"+accountId+"' nicht möglich, ALEXA.INIT Fehler: "+(err.message||err))||console.error(err)&&false;
	log("onAlexaAccountConnected: account "+accountId+" verbunden.");
	account.ready=true;

	await refreshEntitiesFullStructure(accountId);

	// TEST //
	{
		const ids=filterAccountEntityByData(accountId,"TemperatureSensor");
		for(const entityId of ids){
			const entity=getAccountEntity(accountId,entityId);
			const {value,scale}=entity.data.get("TemperatureSensor").temperature;
			const {displayName}=entity;
			log("TemperatureSensor: "+displayName+": "+value+" "+scale);
		}
	}
}

await load();
await start();

return ()=>stop(); // executes when service stops.
