import {
  ExtensionContext,
  TreeDataProvider,
  EventEmitter,
  TreeItem,
  Event,
  window,
  TreeItemCollapsibleState,
  Uri,
  commands,
  workspace,
  TextDocumentContentProvider,
  CancellationToken,
  ProviderResult,
  WorkspaceFolder
} from "vscode";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "async-file";
import { ForceOrgDisplay, OrgInfo } from "./commands/forceOrgDisplay";
import { RequestService } from "./requestService";
import {
  DefineGlobal,
  DefineGlobalResponse
} from "./commands/defineGlobalCommand";
import { SObject } from "./SObject";

interface IEntry {
  name: string;
  custom: boolean;
}

export class SObjectNode {
  constructor(private entry: IEntry, private _parent: string) {}

  public get name(): string {
    return this.entry.name;
  }

  public get custom(): boolean {
    return this.entry.custom;
  }
}

export class SObjectModel {
  private orgInfo: OrgInfo;
  private myRequestService = new RequestService();
  private sobjects: Array<SObject>;
  private readonly sobjectsCachePath: string;

  constructor(private storagePath: string) {
    this.sobjectsCachePath = path.join(storagePath, "sobjects.json");
  }

  private async connect() {
    if (this.orgInfo) {
      return;
    }
    try {
      this.orgInfo = await new ForceOrgDisplay().getOrgInfo();
      this.myRequestService.instanceUrl = this.orgInfo.instanceUrl;
      this.myRequestService.accessToken = this.orgInfo.accessToken;
      console.log("Connected to org ", this.orgInfo.orgName);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private async saveSObjectsToCache(sobjects: Array<SObject>) {
    console.log("Saving sobejcts to cache.");
    try {
      let json = JSON.stringify(sobjects);
      if (!await fs.exists(this.storagePath)) {
        fs.mkdir(this.storagePath);
      }
      await fs.writeFile(this.sobjectsCachePath, json);
    } catch (err) {
      console.log(err);
    }
    return sobjects;
  }

  private async getSObjectsFromCache(): Promise<Array<SObject>> {
    console.log("Attempting to get sobjects from cache.");
    if (await fs.exists(this.sobjectsCachePath)) {
      try {
        let json = await fs.readFile(this.sobjectsCachePath);
        console.log("sObjects retrieved from cache.");
        return JSON.parse(json);
      } catch (err1) {
        console.log(err1);
        try {
          await fs.unlink(this.sobjectsCachePath);
        } catch (err2) {
          console.log(err2);
        }
      }
    }
  }

  private async getSObjectsFromServer() {
    console.log("Getting sObjects from server.");
    return this.connect()
      .then(() => this.myRequestService.execute(new DefineGlobal()))
      .then(response => {
        let obj: DefineGlobalResponse = JSON.parse(response);
        return obj.sobjects;
      });
  }

  public async getSObjects(): Promise<Array<SObject>> {
    if (!this.sobjects) {
      // No warmed cache, try to load from file
      this.sobjects = await this.getSObjectsFromCache();
      if (!this.sobjects) {
        // No cached file, request from server and save to cache
        this.sobjects = await this.getSObjectsFromServer();
        await this.saveSObjectsToCache(this.sobjects);
      }
    }
    return this.sobjects;
  }

  public async refreshCache() {
    this.sobjects = await this.getSObjectsFromServer();
    await this.saveSObjectsToCache(this.sobjects);
  }

  // public getChildren(node: SObjectNode): Thenable<SObjectNode[]> {
  // 	return this.connect().then(client => {
  // 		return new Promise((c, e) => {
  // 			client.list(node.path, (err, list) => {
  // 				if (err) {
  // 					return e(err);
  // 				}

  // 				client.end();

  // 				return c(this.sort(list.map(entry => new FtpNode(entry, this.host, node.path))));
  // 			});
  // 		});
  // 	});
  // }

  // private sort(nodes: SObjectNode[]): SObjectNode[] {
  //   return nodes.sort((n1, n2) => {
  //     // if (n1.isFolder && !n2.isFolder) {
  //     // 	return -1;
  //     // }

  //     // if (!n1.isFolder && n2.isFolder) {
  //     // 	return 1;
  //     // }

  //     return n1.name.localeCompare(n2.name);
  //   });
  // }

  public getContent(resource: Uri): Promise<string> {
    return Promise.resolve("foo");
  }
}

export class SObjectDataProvider
  implements TreeDataProvider<SObjectNode>, TextDocumentContentProvider {
  private _onDidChangeTreeData: EventEmitter<any> = new EventEmitter<any>();
  readonly onDidChangeTreeData: Event<any> = this._onDidChangeTreeData.event;

  private model: SObjectModel;

  constructor(private storagePath: string) {
    this.model = new SObjectModel(storagePath);
  }

  getTreeItem(element: SObjectNode): TreeItem | Thenable<TreeItem> {
    return {
      label: element.name,
      collapsibleState: void 0,
      command: {
        command: "openSObjectNode",
        arguments: [element.name],
        title: "Open sObject"
      },
      iconPath: {
        light: path.join(
          __filename,
          "..",
          "resources",
          "light",
          "document.svg"
        ),
        dark: path.join(__filename, "..", "resources", "dark", "document.svg")
      }
    };
  }

  getChildren(element?: SObjectNode): ProviderResult<SObjectNode[]> {
    return this.model
      .getSObjects()
      .then(sobjects => {
        return sobjects.map(entity => new SObjectNode(entity, "/"));
      })
      .catch(error => {
        console.log(error);
        return new Array<SObjectNode>();
      });
  }

  public provideTextDocumentContent(
    uri: Uri,
    token: CancellationToken
  ): ProviderResult<string> {
    console.log("Loading content for ", uri);
    return this.model.getContent(uri);
  }

  public refresh(): Promise<void> {
    console.log("Refreshing sobjects");
    return this.model.refreshCache().then(() => {
      this._onDidChangeTreeData.fire();
    });
  }
}
