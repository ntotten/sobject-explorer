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

interface ISObjectNode {
  name: string;
  type: string;
  resource: Uri;
}

export class SObjectNode implements ISObjectNode {
  constructor(private sObject: SObject, private _parent: string) {}

  public get name(): string {
    return this.sObject.name;
  }

  public get type(): string {
    return "sObject";
  }

  public get resource(): Uri {
    return Uri.parse("sobject://" + this.sObject.urls.sobject);
  }
}

export class SObjectFieldNode implements ISObjectNode {
  constructor(private sObjectField: any, private _parent: string) {}

  public get name(): string {
    return `${this.sObjectField.name}: ${this.sObjectField.type}`;
  }

  public get type(): string {
    return this.sObjectField.type;
  }

  public get resource(): Uri {
    return Uri.parse(`sobject://${this._parent}/${this.sObjectField.name}`);
  }
}

export class SObjectService {
  private orgInfo: OrgInfo;
  private myRequestService = new RequestService();
  private sobjects: Array<SObject>;
  private sobjectDescriptions: Map<string, any>;
  private readonly sobjectsCachePath: string;

  private template: any;

  constructor(private storagePath: string) {
    this.sobjectDescriptions = new Map<string, any>();
    this.template = Handlebars.compile(`{{#each this}}
{{@key}}: {{this}}
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
    console.info("Attempting to get sobjects from cache.");
    let cacheFilePath = path.join(this.storagePath, fileName);
    if (await fs.exists(cacheFilePath)) {
      try {
        let json = await fs.readFile(cacheFilePath);
        console.info("sObjects retrieved from cache.");
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
    console.info("Getting sObject descriptor for: ", uriPath);
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

  public async getSObjectDescription(resource: Uri): Promise<any> {
    let description;
    if (this.sobjectDescriptions.has(resource.path)) {
      description = this.sobjectDescriptions.get(resource.path);
    } else {
      description = await this.getSObjectFromServer(resource.path);
    }

    return description;
  }

  public async refreshCache() {
    this.sobjects = await this.getSObjectsFromServer();
    await this.saveObjectToCache("sobjects.json", this.sobjects);
  }

  public async getContent(resource: Uri): Promise<string> {
    let resourceUri = Uri.parse(
      `sobjects://${resource.path.substring(0, resource.path.lastIndexOf("/"))}`
    );
    let fieldName = resource.path.substring(resource.path.lastIndexOf("/") + 1);
    let obj = await this.getSObjectDescription(resourceUri);
    let field = obj.fields.find(field => field.name === fieldName);
    return this.template(field);
  }
}

export class SObjectDataProvider
  implements TreeDataProvider<ISObjectNode>, TextDocumentContentProvider {
  private _onDidChangeTreeData: EventEmitter<any> = new EventEmitter<any>();
  readonly onDidChangeTreeData: Event<any> = this._onDidChangeTreeData.event;

  private service: SObjectService;

  constructor(private context: vscode.ExtensionContext) {
    this.service = new SObjectService(context.storagePath);
  }

  getIconName(type: string) {
    let iconName = "document";
    switch (type) {
      case "boolean":
      case "string":
        return type;
      case "double":
      case "int":
        return "number";
      case "sObject":
        return "folder";
      default:
        return "document";
    }
  }

  getTreeItem(element: ISObjectNode): TreeItem | Thenable<TreeItem> {
    return {
      label: element.name,
      collapsibleState:
        element.type === "sObject"
          ? TreeItemCollapsibleState.Collapsed
          : void 0,
      command:
        element.type === "sObject"
          ? void 0
          : {
              command: "openSObjectNode",
              arguments: [element],
              title: "Open sObject"
            },
      iconPath: {
        light: this.context.asAbsolutePath(
          path.join(
            "resources",
            "light",
            this.getIconName(element.type) + ".svg"
          )
        ),
        dark: this.context.asAbsolutePath(
          path.join(
            "resources",
            "dark",
            this.getIconName(element.type) + ".svg"
          )
        )
      }
    };
  }

  getChildren(element?: ISObjectNode): ProviderResult<ISObjectNode[]> {
    if (element) {
      return this.service
        .getSObjectDescription(element.resource)
        .then(obj => {
          return obj.fields.map(
            entity => new SObjectFieldNode(entity, element.resource.path)
          );
        })
        .catch(error => {
          console.error(error);
          return new Array<SObjectFieldNode>();
        });
    } else {
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
  }

  public provideTextDocumentContent(
    uri: Uri,
    token: CancellationToken
  ): ProviderResult<string> {
    return this.service.getContent(uri).catch(error => {
      console.error(error);
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
