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

import {exec} from 'child_process';
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
			textDocumentSync: documents.syncKind,
			// Tell the client that the server supports code completion
			completionProvider: {
				resolveProvider: true
			}
		}
	};
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	//documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'languageServerExample'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(async change => {
	//compileDPScript();
	//validateTextDocument(change.document);
});

let suggestions: any = {};

documents.onDidSave((change)=>{
	compileDPScript();
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
	let dps = exec("java -jar " + extensionDir + "\\DPScript.jar "  + folder,(err,stdout,stderr)=>{
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
		console.log("does " + output + " exists?");
		if (fs.existsSync(output)) {
			console.log("adding errors");
			let json = JSON.parse(fs.readFileSync(output,'utf8'));
			let errors = json.errors;
			let diagnosticMap: any = {};
			for (let err of errors) {
				let file = URI.file(folder + "\\" + err.file).toString();
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
			console.log(diagnosticMap);
			for (let f of documents.all()) {
				console.log(f.uri);
				if (diagnosticMap[f.uri]) {
					console.log("sending diagnostics to " + f.uri);
					connection.sendDiagnostics({uri: f.uri, diagnostics: diagnosticMap[f.uri]});
				} else {
					connection.sendDiagnostics({uri: f.uri, diagnostics: []});
				}
				suggestions = json.suggestions;
			}
		}
		callback();
		dps.kill();
	});
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	// In this simple example we get the settings for every validate run.
	let settings = await getDocumentSettings(textDocument.uri);

	// The validator creates diagnostics for all uppercase words length 2 and more
	let text = textDocument.getText();
	let pattern = /\b[A-Z]{2,}\b/g;
	let m: RegExpExecArray | null;

	let problems = 0;
	let diagnostics: Diagnostic[] = [];
	while ((m = pattern.exec(text)) && problems < settings.maxNumberOfProblems) {
		problems++;
		let diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Warning,
			range: {
				start: textDocument.positionAt(m.index),
				end: textDocument.positionAt(m.index + m[0].length)
			},
			message: `${m[0]} is all uppercase.`,
			source: 'ex'
		};
		if (hasDiagnosticRelatedInformationCapability) {
			diagnostic.relatedInformation = [
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Spelling matters'
				},
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Particularly for names'
				}
			];
		}
		diagnostics.push(diagnostic);
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
	
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		console.log("COMPLETING at " + JSON.stringify(_textDocumentPosition.position));
		return [];
		// The pass parameter contains the position of the text document in
		// which code complete got requested. For the example we ignore this
		// info and always provide the same completion items.
		// let items: CompletionItem[] = [];
		// suggestions.filter((i: any)=>
		// 		i.line == _textDocumentPosition.position.line+1 && i.column <= _textDocumentPosition.position.character && _textDocumentPosition.position.character < i.column + i.length
		// ).map((i: any)=>{
		// 	console.log("found completion " + JSON.stringify(i));
		// 	items.push(...i.values.map((v: any): CompletionItem=>{
		// 		return {
		// 			label: v,
		// 			kind: CompletionItemKind.Text
		// 		};
		// 	}));
		// });
		// return items;
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		// if (item.data === 1) {
		// 	item.detail = 'TypeScript details';
		// 	item.documentation = 'TypeScript documentation';
		// } else if (item.data === 2) {
		// 	item.detail = 'JavaScript details';
		// 	item.documentation = 'JavaScript documentation';
		// }
		return item;
	}
);


connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.textDocument.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.textDocument.text the initial full content of the document.
	compileDPScript();
});


// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
