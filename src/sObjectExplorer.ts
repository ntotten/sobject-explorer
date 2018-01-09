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
  GetDataCommand,
  DefineGlobalResponse,
  GetSObjectResponse
} from "./commands/getDataCommand";
import { SObject } from "./SObject";
import * as Handlebars from "handlebars";

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

export class SObjectService {
  private orgInfo: OrgInfo;
  private myRequestService = new RequestService();
  private sobjects: Array<SObject>;
  private readonly sobjectsCachePath: string;

  private template: any;

  constructor(private storagePath: string) {
    this.template = Handlebars.compile(`# {{name}}
    
{{#each fields}}
{{name}}: {{type}}
{{/each}}`);
  }

  private async connect() {
    if (this.orgInfo) {
      return;
    }
    this.orgInfo = await new ForceOrgDisplay().getOrgInfo();
    this.myRequestService.instanceUrl = this.orgInfo.instanceUrl;
    this.myRequestService.accessToken = this.orgInfo.accessToken;
    console.info("Connected to org ", this.orgInfo.orgName);
  }

  private async saveObjectToCache(fileName, obj: any) {
    let cacheFilePath = path.join(this.storagePath, fileName);
    console.info("Saving sobejcts to cache.");
    try {
      let json = JSON.stringify(obj);
      if (!await fs.exists(this.storagePath)) {
        fs.mkdir(this.storagePath);
      }
      await fs.writeFile(cacheFilePath, json);
    } catch (err) {
      console.error(err);
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
    console.info("Getting sObjects from server.");
    return this.connect()
      .then(() =>
        this.myRequestService.execute(
          new GetDataCommand("services/data/v41.0/sobjects")
        )
      )
      .then(response => {
        let obj: DefineGlobalResponse = JSON.parse(response);
        return obj.sobjects;
      });
  }

  private async getSObjectFromServer(uriPath: string): Promise<any> {
    console.info(
      "Getting sObject from server: ",
      path.join(uriPath, "describe")
    );
    return this.connect()
      .then(() =>
        this.myRequestService.execute(new GetDataCommand(uriPath + "/describe"))
      )
      .then(response => {
        let obj = JSON.parse(response);
        return obj;
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

  public async getContent(resource: Uri): Promise<string> {
    let obj = await this.getSObjectFromServer(resource.path);
    return this.template(obj);
  }
}

export class SObjectDataProvider
  implements TreeDataProvider<SObjectNode>, TextDocumentContentProvider {
  private _onDidChangeTreeData: EventEmitter<any> = new EventEmitter<any>();
  readonly onDidChangeTreeData: Event<any> = this._onDidChangeTreeData.event;

  private service: SObjectService;

  constructor(private context: vscode.ExtensionContext) {
    this.service = new SObjectService(context.storagePath);
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
        light: this.context.asAbsolutePath(
          path.join("resources", "light", "document.svg")
        ),
        dark: this.context.asAbsolutePath(
          path.join("resources", "dark", "document.svg")
        )
      }
    };
  }

  getChildren(element?: SObjectNode): ProviderResult<SObjectNode[]> {
    return this.service
      .getSObjects()
      .then(sobjects => {
        return sobjects.map(entity => new SObjectNode(entity, "/"));
      })
      .catch(error => {
        console.error(error);
        return new Array<SObjectNode>();
      });
  }

  public provideTextDocumentContent(
    uri: Uri,
    token: CancellationToken
  ): ProviderResult<string> {
    return this.service.getContent(uri).catch(error => {
      console.log(error);
      return "Error loading sObject.";
    });
  }

  public refresh(): Promise<void> {
    console.info("Refreshing sobjects");
    return this.service.refreshCache().then(() => {
      this._onDidChangeTreeData.fire();
    });
  }
}
