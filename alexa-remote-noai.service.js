const svr=this; // service object
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
	entities: new Map(),
	entityIds: [],
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
		const account={
			...create_account_template(),
			...svr.accounts[accountId]||{},
			cookie: await rtjscomp.data_load("alexa/account_"+accountId+"/secret_cookie.json"),
		};
		svr.accounts[accountId]=account;
	}
}
const save=async()=>{
	if(!svr.started) return log("save: service not started yet, save later ...")&&false;
	for(const accountId of svr.cfg.accountIds){
		const account=svr.accounts[accountId];
		if(!account.ready) continue;
		if(account.alexa&&account.alexa.cookieData){
			if(JSON.stringify(account.alexa.cookieData)!==JSON.stringify(account.cookie)){
				log("Save: Account Cookie von "+accountId+" geändert, speichere...");
				await rtjscomp.data_save("alexa/account_"+accountId+"/secret_cookie.json",account.alexa.cookieData);
				log("Datei: "+"alexa/account_"+accountId+"/secret_cookie.json"+" wurde GESPEICHERT.");
			}
		}
	}
};
const refreshEntitiesFullStructure=async accountId=>{
	const account=svr.accounts[accountId];
	log("Update aller Identitäten & Geräten ...");
	if(!await new Promise(resolve=>account.alexa.getSmarthomeEntities((err,entries)=>{
		if(err) return resolve(log("Fehler refreshEntitiesFullStructure getSmarthomeEntities bei "+accountId+"! "+err.message) || console.error(err) && false);
		if(!(entries&&entries.length)||!Array.isArray(entries)) return resolve(log("Fehler getSmarthomeEntities gibt kein gültiges Array oder Leeres Array zurück")&&false);
		for(const entry of entries){
			console.log("SmarthomeEntry:",entry);
			
		}
		return true;
	}))) return log("Abbruch von refreshEntitiesFullStructure für Account "+accountId);

}

const start=()=>{
	for(const accountId of svr.cfg.accountIds){
		const account=svr.accounts[accountId];
		if(account.ready){log("account "+accountId+" is still ready not starting once more, stop first!");continue}
		account.ready=false;

		log("Start: Verbinde Amazon Account "+accountId+" ...");
		try{
			account.alexa.init({...ALEXA_OPTS, cookie: account.cookie},(err)=>onAlexaAccountConnected(accountId,err));
		}catch(e){
			log("Start: Verbindung mit Account '"+accountId+"' nicht möglich, ALEXA.INIT Start Fehler: "+(e.message||e));
			account.ready=false;
		}

	}
	svr.started=true;
	interval_save=setInterval(save,INTERVAL_MS_SAVE);
}
const stop=()=>{
	if(!svr.started) log("stop: WARNUNG Service nicht richtig gestartet, FORCE STOP...");
	log("stopping...");
	clearInterval(interval_save); interval_save=0; save(); // Save & Disable Autosave!
	svr.started=false;
	
	for(const accountId of svr.cfg.accountIds){
		const account=svr.accounts[accountId];
		if(!account.ready) continue;
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
}
const onAlexaAccountConnected=(accountId,err)=>{
	const account=svr.accounts[accountId];
	if(err) return log("Verbindung mit Account '"+accountId+"' nicht möglich, ALEXA.INIT Fehler: "+(err.message||err));
	log("onAlexaAccountConnected: account "+accountId+" verbunden.");
	account.ready=true;

	//refreshEntitiesFullStructure(accountId);
}

await load();
await start();

return ()=>stop(); // executes when service stops.
