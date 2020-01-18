/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	createConnection,
	TextDocuments,
	TextDocument,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	Position
} from 'vscode-languageserver';

import URI from "vscode-uri";

import {exec, ChildProcess, spawn} from 'child_process';
import * as fs from 'fs';
import { uriToFilePath } from 'vscode-languageserver/lib/files';

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

let extensionDir: string;
let serverJar: ChildProcess;
let errors: any = {};

connection.onInitialize((params: InitializeParams) => {
	console.log("init server");
	extensionDir = process.cwd();
	console.log("extension path " + extensionDir);
	let capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we will fall back using global settings
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);
	return {
		capabilities: {
			textDocumentSync: documents.syncKind
		}
	};
});

let serverDatapacksPath: string | undefined;

connection.onInitialized(async () => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
	connection.onNotification("server_start",(path)=>{
		serverDatapacksPath = path;
	});
	connection.onNotification("server_stop",()=>{
		serverDatapacksPath = undefined;
	});
	connection.onNotification("compile",async()=>{
		serverJar.stdin.write("/compile " + uriToFilePath((await connection.workspace.getWorkspaceFolders() || [])[0].uri) + "/ignore/out\r\n");
	});
	console.log("launching DPScript server");
	let folders = await connection.workspace.getWorkspaceFolders() || [];
	if (folders.length != 0) {
		let f = folders[0];
		console.log("uri " + f.uri);
		let path = uriToFilePath(f.uri) || "";
		console.log("path " + path);
		try {
			let cmd = "java -jar \"" + extensionDir + "\\DPScriptServer.jar\" " + path;
			console.log(cmd);
			serverJar = spawn('java',['-jar',extensionDir + "\\DPScriptServer.jar",path]);
			serverJar.stdout.on('data',(msg)=>{
				let str = msg.toString('utf8');
				if (str.length > 0 && str != '\n') {
					console.log(str.trim());
				}
			});
			serverJar.stderr.on('data',(stderr)=>{
				if (typeof stderr != 'string') {
					stderr = stderr.toString('utf8');
				}
				if (stderr.startsWith("error:")) {
					let sep1 = stderr.indexOf('|');
					let file = stderr.substring("error:".length,sep1);
					let doc = documents.get(URI.file(file).toString());
					if (doc) {
						let dash = stderr.indexOf('-',sep1+1);
						let sep2 = stderr.indexOf('|',dash);
						let errLine = Number(stderr.substring(sep1+1,dash));
						let errCol = Number(stderr.substring(dash+1,sep2));
						let line = errLine == -1 ? doc ? doc.lineCount - 1 : -1 : errLine;
						let column = errCol;
						let pos = line == -1 ? doc.positionAt(doc.getText().length-1) : Position.create(line-1,column);
						if (!errors[doc.uri]) {
							errors[doc.uri] = [];
						}
						errors[doc.uri].push({
							range: {
								start: pos,
								end: pos
							},
							severity: DiagnosticSeverity.Error,
							message: stderr.substring(sep2+1),
							source: "dpscript"
						});
						connection.sendDiagnostics({uri: URI.file(file).toString(),diagnostics: errors[doc.uri]});
					}
				} else {
					console.log(stderr);
				}
			});
		} catch (err) {
			console.log(err);
		}
	}
});


documents.onDidSave((event)=>{
	if (serverJar) {
		errors[event.document.uri] = [];
		connection.sendDiagnostics({uri: event.document.uri, diagnostics: []});
		console.log("recompiling");
		serverJar.stdin.write("/logerrors\r\n",()=>{
			if (serverDatapacksPath) {
				serverJar.stdin.write("/compile " + serverDatapacksPath + "\r\n",()=>{
					connection.sendNotification("reload_server");
				});
			}
		});
		
	}
	//compileDPScript();
});

async function compileDPScript() {
	let folders = await connection.workspace.getWorkspaceFolders();
	if (!folders) {
		return;
	}
	let i = 0;
	let datapacks = folders || [];
	let callback = ()=>{
		if (i < datapacks.length) {
			compileDatapack(uriToFilePath(datapacks[i++].uri) || "",callback);
		}
	};
	callback();

}

async function compileDatapack(folder: string, callback: ()=>void) {
	console.log("compiling datapack " + folder);
	let dps = exec("java -jar \"" + extensionDir + "\\DPScript.jar\" " + folder,(err,stdout,stderr)=>{
		if (stdout) {
			console.log(stdout);
		}
		if (stderr) {
			console.log(stderr);
		}
		if (err) {
			console.log(err);
		}
	});
	dps.on('exit',(code,signal)=>{
		let output = extensionDir + "\\compilerOutput.json";
		if (fs.existsSync(output)) {
			let json = JSON.parse(fs.readFileSync(output,'utf8'));
			let errors = json.errors;
			let diagnosticMap: any = {};
			for (let err of errors) {
				let file = URI.file(err.file).toString();
				let doc = documents.get(file);
				if (!doc) continue;
				let line = err.line == -1 ? doc ? doc.lineCount - 1 : -1 : err.line;
				let column = err.column;
				let pos = line == -1 ? doc.positionAt(doc.getText().length-1) : Position.create(line-1,column);
				let msg = err.message;
				console.log("adding error at " + pos + " to file " + file);
				let diagnostics = diagnosticMap[file] || [];
				diagnostics.push({
					severity: DiagnosticSeverity.Error,
					range: {
						start: pos,
						end: pos
					},
					message: msg,
					source: "dpscript"
				});
				diagnosticMap[file] = diagnostics;
			}
			for (let f of documents.all()) {
				if (diagnosticMap[f.uri]) {
					console.log("sending errors to " + f.uri);
					connection.sendDiagnostics({uri: f.uri, diagnostics: diagnosticMap[f.uri]});
				} else {
					connection.sendDiagnostics({uri: f.uri, diagnostics: []});
				}
			}
		}
		callback();
		dps.kill();
	});
}

connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.textDocument.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.textDocument.text the initial full content of the document.
	//compileDPScript();
});


// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
