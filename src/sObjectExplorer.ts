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

export class SObjectNode {
  constructor(private sObject: SObject, private _parent: string) {}

  public get name(): string {
    return this.sObject.name;
  }

  public get custom(): boolean {
    return this.sObject.custom;
  }

  public get resource(): Uri {
    return Uri.parse("sobject://" + this.sObject.urls.sobject);
  }
}

export class SObjectModel {
  private orgInfo: OrgInfo;
  private myRequestService = new RequestService();
  private sobjects: Array<SObject>;
  private readonly sobjectsCachePath: string;

  constructor(private storagePath: string) {}

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

  private async saveObjectToCache(fileName, obj: any) {
    let cacheFilePath = path.join(this.storagePath, fileName);
    console.log("Saving sobejcts to cache.");
    try {
      let json = JSON.stringify(obj);
      if (!await fs.exists(this.storagePath)) {
        fs.mkdir(this.storagePath);
      }
      await fs.writeFile(cacheFilePath, json);
    } catch (err) {
      console.log(err);
    }
  }

  private async getObjectFromCache(fileName): Promise<any> {
    console.log("Attempting to get sobjects from cache.");
    let cacheFilePath = path.join(this.storagePath, fileName);
    if (await fs.exists(cacheFilePath)) {
      try {
        let json = await fs.readFile(cacheFilePath);
        console.log("sObjects retrieved from cache.");
        return JSON.parse(json);
      } catch (err1) {
        console.warn(err1);
        try {
          await fs.unlink(cacheFilePath);
        } catch (err2) {
          console.warn(err2);
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
      this.sobjects = await this.getObjectFromCache("sobjects.json");
      if (!this.sobjects) {
        // No cached file, request from server and save to cache
        this.sobjects = await this.getSObjectsFromServer();
        await this.saveObjectToCache("sobjects.json", this.sobjects);
      }
    }
    return this.sobjects;
  }

  public async refreshCache() {
    this.sobjects = await this.getSObjectsFromServer();
    await this.saveObjectToCache("sobjects.json", this.sobjects);
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
        arguments: [element],
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
