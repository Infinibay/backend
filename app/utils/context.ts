import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { User } from "@prisma/client";

export interface InfinibayContext {
    req: Request
    res: Response
    // user should be of User prisma type or null
    user: User | null
    prisma: PrismaClient
  }

