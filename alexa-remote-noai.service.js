const svr=this; // service object
const v=rtjscomp.verbose&&rtjscomp.verbose.includes("web/alexa/alexa-remote");

svr.cfg={};
svr.accounts={};

svr.started=false;
const EMPTY_ARRAY=[];
const EMPTY_OBJECT={};
const EMPTY_FUNCTION=()=>{};

const ALEXA_OPTS = {
	//autoQueryActivityOnTrigger: true, // bei jedem Trigger automatisch den Transkript-Text holen (alt)
	acceptLanguage: 'de-DE',
	alexaServiceHost: 'alexa.amazon.de',
	amazonPage: 'amazon.de',
	bluetooth: false,
	logger: EMPTY_FUNCTION,
	proxyLogLevel: "warn",
	proxyOnly: true,
	proxyOwnIp: "127.0.0.1",
	proxyPort: 8080,
	useWsMqtt: true, // Push-Verbindung an
};

const create_entity_template=id=>({
	displayName: "",
	description: "",
	serialNumber: "",
	id,
	deviceType: "",
	//availability: "",
	capabilities: EMPTY_ARRAY,
	data: new Map(),
	supportedOperations: EMPTY_ARRAY,
	supportedProperties: EMPTY_ARRAY,
});

const create_account_template=id=>({
	alexa: new Alexa(),
	cookie: null,
	entities: [],
	entityIds: [],
	id,
	intervals: [],
	ready: false,
});

let interval_save=0; const INTERVAL_MS_SAVE=1e3*60*3;
const INTERVAL_MS_refreshEntitiesFull=1e3*60*5;

const Alexa=require("alexa-remote2");

const load=async()=>{
	const loaded_config=await rtjscomp.data_load("alexa/config.json")
	if(!loaded_config) throw "ERROR: CONFIG: alexa/config.json not exists! CREATE IT FIRST xD";
	if(svr.cfg===EMPTY_OBJECT) svr.cfg={...loaded_config};
	else Object.assign(svr.cfg, loaded_config);
	
	if(svr.cfg.ALEXA_OPTS) Object.assign(ALEXA_OPTS, svr.cfg.ALEXA_OPTS);
	
	log("Lade Accounts: "+svr.cfg.accountIds.join(", ")+" ...");
	for(const accountId of svr.cfg.accountIds){
		let account=undefined;
		if(hasAccount(accountId)){
			log("loading and modifying account: "+accountId);
			account=Object.assign(getAccount(accountId),{
				cookie: await rtjscomp.data_load("alexa/account_"+accountId+"/secret_cookie.json"),
			});
			if(!account.cookie) log("load: WARN: kein Cookie für '"+accountId+"', viel Spaß beim Alexa-Login!");
		}
		else{

			// TODO Check if "alexa/account_xx" not exists, so program dont have to crash xD
			if(svr.accounts===EMPTY_OBJECT) svr.accounts={};
			svr.accounts[accountId]={
				...create_account_template(accountId),
				cookie: await rtjscomp.data_load("alexa/account_"+accountId+"/secret_cookie.json"),
			}
			account=getAccount(accountId);
		}
	}
}
const save=async()=>{
	if(svr.accounts===EMPTY_OBJECT||svr.cfg===EMPTY_OBJECT) return log("save: svr.accounts or svr.cfg is EMPTY_OBJECT service not started or broken, dont save")&&false;
	for(const accountId of svr.cfg.accountIds){
		const account=getAccount(accountId);
		//if(!account.ready) continue;
		if(account.alexa.cookieData){
			log("account: "+accountId+" checking for alexa.cookieData");
			if(!account.cookie) log("save: Derzeit kein Cookie gespeichert!")
			if(JSON.stringify(account.alexa.cookieData)!==JSON.stringify(account.cookie)){
				log("Save: Account Cookie von "+accountId+" geändert, speichere...");
				await rtjscomp.data_save("alexa/account_"+accountId+"/secret_cookie.json",account.alexa.cookieData);
				log("Datei: "+"alexa/account_"+accountId+"/secret_cookie.json"+" wurde GESPEICHERT.");
				// statt Object.assign(account.cookie, account.alexa.cookieData):
				account.cookie=JSON.parse(JSON.stringify(account.alexa.cookieData));
			}
			else log("not saving cookie, nothing changed: "+accountId);
		}
		else log("not saving account cookieData, because not exists for acc: "+accountId);
	}
};
const throw_error=message=>{throw new Error(message); return false}
const getAccount=accountId=>svr.accounts[accountId]||throw_error("getAccount: accountId not exists: "+accountId); // use 'hasAccount(id)' to check
const hasAccount=accountId=>svr.accounts[accountId]!==undefined;
const getAccountEntity=(accountId,entityId)=>getAccount(accountId).entities.find(entity=>entity.id===entityId)||throw_error("account "+accountId+" dont have entity with 'ID' "+entityId);
const hasAccountEntity=(accountId,entityId)=>getAccount(accountId).entities.some(entity=>entity.id===entityId);
const getAccountEntityBy=(accountId,entityKey,entityValue)=>getAccount(accountId).entities.find(entity=>entity[entityKey]===entityValue)||throw_error("account "+accountId+" dont have entity with entity['"+entityKey+"'] == '"+entityValue+"'");
const hasAccountEntityBy=(accountId,entityKey,entityValue)=>getAccount(accountId).entities.some(entity=>entity[entityKey]===entityValue);
const filterAccountEntityByData=(accountId,entityDataNamespace)=>getAccount(accountId).entities.filter(entity=>entity.data.has(entityDataNamespace)).map(item=>item.id);
const filterAccountEntityByCapability=(accountId,entityCapability)=>getAccount(accountId).entities.filter(entity=>entity.capabilities&&entity.capabilities.includes(entityCapability)).map(item=>item.id);
const findEntity=entityId=>Object.values(svr.accounts).map(item=>item.entities).map(accEnt=>accEnt.find(item=>item.id===entityId)).filter(Boolean)[0]||throw_error("entityId dont exists in any accounts: "+entityId);

const refreshEntitiesFullStructure=async accountId=>{
	const account=getAccount(accountId);
	log("Update aller Identitäten & Geräten für "+accountId+" ...");
	if(!await new Promise(resolve=>account.alexa.getSmarthomeEntities((err,entries)=>{
		if(err) return resolve(log("Fehler refreshEntitiesFullStructure getSmarthomeEntities bei "+accountId+"! "+err.message) || console.error(err) && false);
		if(!(entries&&entries.length)||!Array.isArray(entries)) return resolve(log("Fehler getSmarthomeEntities gibt kein gültiges Array oder Leeres Array zurück")&&false);
		log("Durchsuche "+entries.length+" Entities ...");
		for(const entity of entries){
			//console.log("SmarthomeEntry:",entity);
			const entity_new={
				//availability: entity.availability,
				description: entity.description,
				deviceType: entity.providerData.deviceType,
				displayName: entity.displayName,
				id: entity.id,
				serialNumber: entity.providerData.dmsDeviceIdentifiers.length&&entity.providerData.dmsDeviceIdentifiers[0].deviceSerialNumber||"",
				supportedOperations: entity.supportedOperations||EMPTY_ARRAY,
				supportedProperties: entity.supportedProperties||EMPTY_ARRAY,
			};
			if(hasAccountEntity(accountId,entity.id)){
				log("update entity: "+accountId+", "+entity_new.displayName);
				Object.assign(getAccountEntity(accountId,entity.id),entity_new);
			}
			else{
				log("new entity: "+accountId+", "+entity_new.displayName);
				account.entities.push({
					...create_entity_template(entity_new.id),
					...entity_new,
				});
				account.entityIds.push(entity_new.id);
			}
			//console.log("SmarthomeEntry SERVICE OBJECT:",entity_new);
		}

		resolve(true);
	}))) return log("Abbruch von refreshEntitiesFullStructure für Account "+accountId);

	if(!await new Promise(resolve=>account.alexa.querySmarthomeDevices(account.entityIds, 'ENTITY',(err,entriesData)=>{
		if(err) return resolve(log("Fehler refreshEntitiesFullStructure querySmarthomeDevices bei "+accountId+"! "+err.message)||console.error(err)&&false);
		//console.log(JSON.stringify(entriesData.deviceStates,null,2));
		if(!entriesData.deviceStates||entriesData.deviceStates.length===0) return resolve(log("Fehler querySmarthomeDevices gibt kein gültiges Array oder Leeres Array zurück")&&false);
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
	}))) return log("Abbruch von refreshEntitiesFullStructure für Account "+accountId)&&false;

	for(const serial of Object.keys(account.alexa.serialNumbers)){
		const serialEntity=account.alexa.serialNumbers[serial];
		const {
			capabilities,
			hasMusicPlayer,
			isControllable,
			//isMultiroomDevice,
			//isMultiroomMember,
			//sendCommand,
			serialNumber,
		}=serialEntity;
		//log("account.alexa.serialNumbers: "+serialNumber)
		if(!hasAccountEntityBy(accountId,"serialNumber",serialNumber)) continue;
		const entity=getAccountEntityBy(accountId,"serialNumber",serialNumber);
		log(accountId+": SET: "+entity.displayName+".capabilities = "+capabilities.length);
		Object.assign(entity,{
			capabilities,
			hasMusicPlayer,
			isControllable,
			//isMultiroomDevice,
			//isMultiroomMember,
			//sendCommand,
		});
	}

}
const sendCommand=async(accountId,entityId,command,value,cb)=>{
	const account=getAccount(accountId);
	const entity=getAccountEntity(accountId,entityId);
	if(command==="speak"){
		if(!entity.serialNumber) throw new Error(accountId+": sendCommand: speak, not supported, because no SerialNumber for entity: "+entity.displayName);
		if(!entity.capabilities.includes("AUDIO_PLAYER")) throw new Error(accountId+": sendCommand: speak, not supported, because capability 'AUDIO_PLAYER' not exits for entity: "+entity.displayName);
		log(accountId+": "+entity.displayName+" (speak): "+value);
		const [err,dat]=await new Promise(resolve=>account.alexa.sendSequenceCommand(entity.serialNumber,"speak",value,(err,dat)=>{
			if(cb) cb(err,dat);
			resolve([err,dat]);
		}));
		if(err) log(accountId+": "+entity.displayName+": speak ERROR: "+err.message);
		else log(accountId+": "+entity.displayName+": speak success");
		return err;
	}
	else if(command==="turnOff"||command==="turnOn"){
		if(!entity.supportedOperations.includes(command)) throw new Error("sendCommand: entity('"+entity.displayName+"').supportedOperations dont include: "+command);
		log(accountId+": "+entity.displayName+" (cmd): "+command);
		const [err,dat]=await new Promise(resolve=>account.alexa.executeSmarthomeDeviceAction([entityId],{action:command},"ENTITY",(err,dat)=>{
			if(cb) cb(err,dat);
			resolve([err,dat]);
		}));
		if(err) log(accountId+": "+entity.displayName+": "+command+" ERROR: "+err.message);
		else{
			log(accountId+": "+entity.displayName+": "+command+" success");
			//entity.data // TODO CHANGE STATE
		}
		return err;
	}
	else throw new Error("sendCommand: command dont exists: "+command);
}
const speak=(accountId,text)=>{
	const entityId=filterAccountEntityByCapability(accountId,"AUDIO_PLAYER")[0];
	if(!entityId) throw new Error(accountId+" speak: account dont have any entity with AUDIO_PLAYER capability!");
	return sendCommand(accountId,entityId,"speak",text);
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
			},(err)=>onAlexaAccountConnected(accountId,err).then(EMPTY_FUNCTION).catch(err=>{
				log("FEHLER BEIM STARTEN VON ACCOUNT: "+accountId+", Fehler: "+err.message);
				console.error(err);
			}));
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
		account.interval=[]
		while(account.interval.length){
			const interval=account.interval.shift();
			log("stop: clearInterval: "+interval[0]+" - "+interval[1]);
			clearInterval(interval[1]);
		}

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

	await refreshEntitiesFullStructure(accountId);
	account.ready=true;

	account.intervals.push([
		"refreshEntitiesFull",
		setInterval(()=>refreshEntitiesFullStructure(accountId),INTERVAL_MS_refreshEntitiesFull),
	]);

	// TEST TemperatureSensor //
	{
		const ids=filterAccountEntityByData(accountId,"TemperatureSensor");
		for(const entityId of ids){
			const entity=getAccountEntity(accountId,entityId);
			const {value,scale}=entity.data.get("TemperatureSensor").temperature;
			const {displayName}=entity;
			log("TemperatureSensor: "+displayName+": "+value+" "+scale);
			//console.log(entity.data);
		}
	}
	// TEST AUDIO_PLAYER //
	speak(accountId,"RTJSCOMP Service gestartet!");

	// TEST SMART_PLUG //
	{
		const entity=getAccountEntityBy(accountId,"displayName","Lichterkette");
		await sendCommand(accountId,entity.id,"turnOn");
	}
}

await load();
await start();

return ()=>stop(); // executes when service stops.
