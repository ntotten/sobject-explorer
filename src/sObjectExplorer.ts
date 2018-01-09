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
import { ForceOrgDisplay, OrgInfo } from "./commands/forceOrgDisplay";
import { RequestService } from "./requestService";
import {
  DefineGlobal,
  DefineGlobalResponse
} from "./commands/defineGlobalCommand";

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

  constructor(cache?: any) {}

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

  public get roots(): Promise<SObjectNode[]> {
    return this.connect()
      .then(() => this.myRequestService.execute(new DefineGlobal()))
      .then(response => {
        let obj: DefineGlobalResponse = JSON.parse(response);
        return obj.sobjects;
      })
      .then(list => {
        console.log("Returned sObjects");
        return list.map(entity => new SObjectNode(entity, "/"));
      })
      .catch(error => {
        console.log(error);
        return new Array<SObjectNode>();
      });
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

  constructor(private storagePath: string) {}

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
    if (!this.model) {
      this.model = new SObjectModel();
    }
    return this.model.roots;
  }

  public provideTextDocumentContent(
    uri: Uri,
    token: CancellationToken
  ): ProviderResult<string> {
    console.log("Loading content for ", uri);
    return this.model.getContent(uri);
  }

  refresh() {
    this.getChildren();
  }
}
