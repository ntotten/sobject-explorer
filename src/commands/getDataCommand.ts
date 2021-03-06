/*
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { BaseCommand } from "./baseCommand";
import { SObject } from "../SObject";

export class GetSObjectResponse {
  public encoding: string;
  public maxBatchSize: number;
  public objectDescribe: SObject;
}

export class DefineGlobalResponse {
  public encoding: string;
  public maxBatchSize: number;
  public sobjects: SObject[];
}

export class GetDataCommand extends BaseCommand {
  public constructor(path) {
    super(path, "GET");
  }
}
