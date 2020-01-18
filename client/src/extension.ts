
import * as path from 'path';
import * as vscode from 'vscode';
import { launchClient, launchServer, MinecraftServer, MinecraftClient } from 'minecraft_utils';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
	CompletionItemKind
} from 'vscode-languageclient';
import { copyFileSync, existsSync } from 'fs';

let extensionPath;

let client: LanguageClient;
let mcserver: MinecraftServer;
let mcclient: MinecraftClient;

let minecraftTestPath = vscode.workspace.workspaceFolders[0].uri.fsPath + '/ignore/minecraft/';

export function activate(context: vscode.ExtensionContext) {
	extensionPath = context.extensionPath;
	// The server is implemented in node

	let serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);
	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'], cwd: context.extensionPath };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc, options: {cwd: context.extensionPath} },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: 'file', language: 'dpscript' }],
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'dpscriptLanguageServer',
		'DPScript Language Server',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();

	let startTest = vscode.commands.registerCommand("dpscript.startTestServer",(args)=>{
		startTestServer();
	});
	let compile = vscode.commands.registerCommand("dpscript.compileDPScript",(args)=>{
		client.sendNotification("compile");
	});

	let defaultCompletion = vscode.languages.registerCompletionItemProvider('dpscript',{
		provideCompletionItems(doc,pos,token,ctx) {
			console.log("completing default");
			let objective = new vscode.CompletionItem("objective");
			objective.insertText = new vscode.SnippetString('objective ${1:name}');
			objective.documentation = "Creates a new objective to use on entities.";
			let cons = new vscode.CompletionItem("const");
			cons.insertText = new vscode.SnippetString('const ${2:name} = ${1:value}');
			cons.documentation = new vscode.MarkdownString("Creates a constant entry in the `Consts` objective that is assigned on load and cannot be changed.");
			let tick = new vscode.CompletionItem("tick");
			tick.insertText = new vscode.SnippetString('tick {\n\t$0\n}');
			tick.documentation = "The main function. Called every tick at the start of the server loop.";
			let func = new vscode.CompletionItem("function");
			func.insertText = new vscode.SnippetString('function ${1:name} {\n\t$0\n}');
			func.documentation = "A function block. Can be called by a selector or from the server (through tick)";
			return [
				objective,
				cons,
				tick,
				func
			];
		}
	});
	let selector = vscode.languages.registerCompletionItemProvider('dpscript', {
		provideCompletionItems(doc,pos,token,ctx) {
			console.log("completing selector");
			
			let word = doc.getWordRangeAtPosition(pos);
			let line = doc.lineAt(pos.line).text;
			if (word && line.charAt(word.start.character-1) !== '@' && !ctx.triggerCharacter) {
				console.log("not completing selector");
				return;
			}
			let targets = {
				"e": ["Targets all entities","all","any","entity","entities"],
				"a": ["Targets all players","players","everyone","allplayers"],
				"p": ["Targets the nearest player","closest","nearest","player"],
				"r": ["Targets a random player (or entity if provided [type=?])","random"],
				"s": ["Targets the executing entity","this","self","me"]
			};
			let items = [];
			for (let e of entities) {
				let i = new vscode.CompletionItem(e,CompletionItemKind.Class);
				i.documentation = "Targets all " + pluralizeEntity(e) + ". (Translates to @e[type=" + e + "])";
				items.push(i);
			}
			for (let t in targets) {
				let doc = targets[t][0];
				let i = new vscode.CompletionItem(t,CompletionItemKind.Field);
				i.documentation = doc;
				i.detail = "Aliases: " + targets[t].slice(1).join(', ');
				items.push(i);
			}
			return items;
		}
	},'@');
	let selectorParams = vscode.languages.registerCompletionItemProvider('dpscript', {
		provideCompletionItems(doc,pos,token,ctx) {
			console.log("completing selector params");
			let line = doc.lineAt(pos.line).text.substring(0,pos.character);
			if (line.lastIndexOf('[') > line.lastIndexOf(']')) {
				let targetRange = doc.getWordRangeAtPosition(new vscode.Position(pos.line,line.lastIndexOf('[')-1));
				let lineUntilSelector = line.substring(0,targetRange.start.character);
				if (lineUntilSelector.charAt(lineUntilSelector.trimRight().length-1) == '@') {
					let gamemode = new vscode.CompletionItem('gamemode',CompletionItemKind.Property);
					gamemode.documentation = "Selects players set to the specified gamemode. Can be an index (like until 1.12) or gamemode name";
					let tag = new vscode.CompletionItem('tag',CompletionItemKind.Property);
					tag.documentation = "Selects entities with the specified tag";
					let tags = new vscode.CompletionItem('tags',CompletionItemKind.Property);
					tags.documentation = "Selects entities with the specified tag list inside [ ]";
					return [gamemode,tag,tags];
				}
			}
		}
	},'[',',');


	let signatureHelpers = vscode.languages.registerSignatureHelpProvider('dpscript',{
		provideSignatureHelp(doc, pos, t, ctx) {
			console.log("activated signature help");
			let line = doc.lineAt(pos.line);
			let parenIndex = line.text.substring(0,pos.character+1).lastIndexOf('(');
			if (parenIndex === -1) return;
			let method = doc.getWordRangeAtPosition(pos.translate(0,parenIndex - pos.character));
			let token = doc.getText(method);
			for (let m in selectorMembers) {
				if (token == m) {
					let value = selectorMembers[m];
					let paramsString = "";
					if (value.params) {
						for (let p in value.params) {
							paramsString += "- *" + p + "*: " + value.params[p] + "\n";
						}
					}
					return {
						signatures: [{
							label: value.usage,
							documentation: new vscode.MarkdownString(`${value.doc}${paramsString == "" ? "" : `\n\n#### Parameters:\n${paramsString}`}`),
							parameters: []
						}],
						activeParameter: -1,
						activeSignature: 0
					};
				}
			}
			return new vscode.SignatureHelp();
		}
	},'(',',');

	let selectorMember = vscode.languages.registerCompletionItemProvider('dpscript',{
		provideCompletionItems(doc,pos,token,ctx) {
			console.log("Completing entity selector member");
			let line = doc.lineAt(pos.line).text.substring(0,ctx.triggerCharacter ? pos.character-1 : doc.getWordRangeAtPosition(pos.translate(0,-1)).start.character-1);
			let line2 = "";
			try {
				line2 = line.substring(0,doc.getWordRangeAtPosition(pos.translate(0,-1)).start.character);
				// console.log("line 2: '" + line2 + "'");
			} catch (e) {}
			if (line.charAt(line.trimRight().length - 1) === ']' || line2.charAt(line2.trimRight().length-1) === '@') {
				// console.log("last @: " + line.lastIndexOf('@'));
				// console.log("last [: " + line.lastIndexOf('['));
				// console.log("second to last ]: " + line.substring(0,line.lastIndexOf(']')).lastIndexOf(']'));
				if ((line.lastIndexOf('@') < line.lastIndexOf('[') || line.lastIndexOf('[') == -1) && line.lastIndexOf('@') > line.substring(0,line.lastIndexOf(']')).lastIndexOf(']')) {
					let items = [];
					for (let k in selectorMembers) {
						let member = selectorMembers[k];
						let i = new vscode.CompletionItem(k,CompletionItemKind.Method);
						if (member.snippet) {
							i.insertText = new vscode.SnippetString(member.snippet);
						} else if (member.insert) {
							i.insertText = member.insert;
						}
						if (member.doc) {
							i.documentation = member.doc;
						}
						if (member.syntax) {
							i.detail = member.syntax;
						}
						items.push(i);
					}
					return items;
				}
			}
		}
	},'.');

	

	let hover = vscode.languages.registerHoverProvider('dpscript',{
		provideHover(doc,pos,t) {
			let range = doc.getWordRangeAtPosition(pos);
			let token = doc.getText(range);
			for (let sm in selectorMembers) {
				if (token == sm) {
					return new vscode.Hover(selectorMembers[sm].doc);
				}
			}
		}
	});

	context.subscriptions.push(defaultCompletion , selector, selectorParams, selectorMember, signatureHelpers, hover, startTest, compile);
	
}

let entities = ["item","xp_orb","area_effect_cloud","elder_guardian","wither_skeleton","stray","egg","leash_knot","painting","arrow","snowball","fireball","small_fireball","ender_pearl","eye_of_ender_signal","potion","xp_bottle","item_frame","wither_skull","tnt","falling_block","fireworks_rocket","husk","spectral_arrow","shulker_bullet","dragon_fireball","zombie_villager","skeleton_horse","zombie_horse","armor_stand","donkey","mule","evocation_fangs","evocation_illager","vex","vindication_illager","illusion_illager","commandblock_minecart","boat","minecart","chest_minecart","furnace_minecart","tnt_minecart","hopper_minecart","spawner_minecart","creeper","skeleton","spider","giant","zombie","slime","ghast","zombie_pigman","enderman","cave_spider","silverfish","blaze","magma_cube","ender_dragon","wither","bat","witch","endermite","guardian","shulker","pig","sheep","cow","chicken","squid","wolf","mooshroom","snowman","ocelot","iron_golem","horse","rabbit","polar_bear","llama","llama_spit","parrot","villager","ender_crystal"];

let plurals = {
	"endermans": "endermen",
	"evocation fangss": "evocation fangs",
	"sheeps": "sheep",
	"vexs": "vexes",
	"snowmans": "snowmen",
	"wolfs": "wolves",
	"silverfishs": "silverfishes",
	"witchs": "witches",
	"tnts": "tnt",
	"rabbits": "rabbi"
};

function pluralizeEntity(e) {
	let plural = e.replace(/\_/gi," ") + "s";
	if (plurals[plural]) return plurals[plural];
	return plural;
}

let selectorMembers = {
	"effect": {
		"snippet": "effect($1)",
		"doc": "Adds a potion effect to the entity",
		"usage": "effect(<effectId> [tier] for [duration] [hide])",
		"params": {
			"effectId": "ID of the effect to give. \nFor example: swiftness, blindness, haste... \nAliases like 'regen' or 'speed' are also allowed.",
			"tier":"The level of the effect. Could be a number (0 means level 1) or a roman number, for example II for tier 2",
			"duration": "The duration of the effect. Defaults to 30 seconds. \n\nExample valid values: 5s, 100ms, 65ticks, 20mins",
			"hide": "Add the 'hide' keyword to disable the effect's particles."
		}
	},
	"grant": {
		"snippet": "grant(${1|only,from,until,all|} $0)",
		"doc": "Grants a player a specified advancement, a range of advancements or all."
	},
	"revoke": {
		"snippet": "revoke(${1|only,from,until,all|} $0)",
		"doc": "Removes from a player a specified advancement, a range of advancements or all."
	},
	"clear": {
		"snippet": "clear($0)",
		"doc": "Clears items from the player inventory",
		"usage":"clear([item] [nbt] * [amount])",
		"params": {
			"item": "The item ID to clear",
			"nbt": "Optional NBT predicate for the item",
			"amount": "A specific amount to clear. 0 will just simulate and return the number of items matched, and if omitted will clear every item"
		}
	},
	"title": {
		"snippet": "title($0)",
		"doc": "Displays a title for a player"
	},
	"subtitle": {
		"snippet": "subtitle($0)",
		"doc": "Displays a sub title for a player"
	},
	"action": {
		"snippet": "action($0)",
		"doc": "Displays a message above the player's hotbar"
	},
	"titleTimes": {
		"snippet": "titleTimes(${1:10},${2:70},${3:20})",
		"doc": "Changes the title duration parameters (fade in, stay, fade out)"
	},
	"nbt": {
		"doc": "Modifies or queries the entity's nbt data"
	},
	"gamemode": {
		"snippet": "gamemode = ${1|survival,creative,spectator,adventure|}",
		"doc": "Changes the player's gamemode"
	},
	"enchant": {
		"snippet": "enchant(${1|aqua_affinity,bane_of_arthropods,blast_protection,channeling,binding_curse,vanishing_curse,depth_strider,efficiency,feather_falling,fire_aspect,fire_protection,flame,fortune,frost_walker,impaling,infinity,knockback,looting,loyalty,luck_of_the_sea,lure,mending,multishot,piercing,power,projectile_protection,protection,punch,quick_charge,respiration,riptide,sharpness,silk_touch,smite,sweeping,thorns,unbreaking|})",
		"doc": "Adds an enchantment to the tool the player is holding"
	},
	"tag": {
		"snippet": "tag($0)",
		"doc": "Adds a tag to an entity, to be targeted in a selector using @e[tag=<tag>]"
	},
	"untag": {
		"snippet": "untag($0)",
		"doc": "Removes a tag from an entity"
	},
	"xp": {
		"doc": "Adds, changes or queries the player's experience"
	},
	"spawn": {
		"doc": "Sets the player's spawn point"
	},
	"kill": {
		"insert": "kill()",
		"doc": "Removes the entity/s selected by this selector."
	},
	"tp": {
		"snippet": "tp($0)",
		"doc": "Teleports the entity to the specified location"
	},
	"tellraw": {
		"snippet": "tellraw($0)",
		"doc": "Sends a formatted JSON message to the player"
	},
	"give": {
		"snippet": "give($0)",
		"doc": "Inserts an item to a player's inventory"
	}
};


async function startTestServer() {
	console.log("STARTING TEST SERVER");
	mcserver = await launchServer({dir: minecraftTestPath + 'server/',properties: {"online-mode": "false"}});
	mcserver.on("ready",async (s)=>{
		mcclient = await launchClient({dir: minecraftTestPath + 'client/', jvmArgs: "--username DPScriptDev"});
		mcserver.sendCommand("op DPScriptDev");
		copyFileSync(extensionPath + "/servers.dat",minecraftTestPath + "client/servers.dat");
		mcclient.on("close",()=>{
			mcserver.process.kill();
		});
		client.sendNotification("server_start",minecraftTestPath + 'server/world/datapacks/');
	});
	mcserver.on("stop",()=>{
		client.sendNotification("server_stop");
	});
	client.onNotification("reload_server",()=>{
		mcserver.sendCommand("reload");
	});
}


export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	if (mcserver) {
		mcserver.process.kill();
	}
	if (mcclient) {
		mcclient.process.kill();
	}
	return client.stop();
}
