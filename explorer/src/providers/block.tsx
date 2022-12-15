import React from "react";
import * as Sentry from "@sentry/react";
import * as Cache from "providers/cache";
import {
  Connection,
  LAMPORTS_PER_SOL,
  MessageV0,
  PublicKey,
  VersionedBlockResponse,
  VersionedMessage,
} from "@solana/web3.js";
import { useCluster, Cluster } from "./cluster";
import { ConsumeEventsPermissionedDetailsCard } from "components/instruction/serum/ConsumeEventsPermissionedDetails";

export enum FetchStatus {
  Fetching,
  FetchFailed,
  Fetched,
}

export enum ActionType {
  Update,
  Clear,
}

type Block = {
  block?: VersionedBlockResponse;
  blockLeader?: PublicKey;
  childSlot?: number;
  childLeader?: PublicKey;
  parentLeader?: PublicKey;
};

type State = Cache.State<Block>;
type Dispatch = Cache.Dispatch<Block>;

const StateContext = React.createContext<State | undefined>(undefined);
const DispatchContext = React.createContext<Dispatch | undefined>(undefined);

type BlockProviderProps = { children: React.ReactNode };

export function BlockProvider({ children }: BlockProviderProps) {
  const { url } = useCluster();
  const [state, dispatch] = Cache.useReducer<Block>(url);

  React.useEffect(() => {
    dispatch({ type: ActionType.Clear, url });
  }, [dispatch, url]);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useBlock(key: number): Cache.CacheEntry<Block> | undefined {
  const context = React.useContext(StateContext);

  if (!context) {
    throw new Error(`useBlock must be used within a BlockProvider`);
  }

  return context.entries[key];
}

async function _fetchBlock(
  connectionUrl: string,
  slot: number
): Promise<VersionedBlockResponse> {
  const endpointUrl = `${window.location.protocol}//${window.location.host}/api/getBlock`;
  let block: VersionedBlockResponse = await fetch(endpointUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connection: connectionUrl,
      block: slot,
    }),
  }).then((res) => res.json());

  for (let tx of block.transactions) {
    let meta = tx.meta;
    // Deserialize pubkeys in meta
    if (meta) {
      let loadedAddresses = meta.loadedAddresses;
      if (loadedAddresses) {
        loadedAddresses.writable = loadedAddresses.writable.map(
          (key) => new PublicKey(key)
        );
        loadedAddresses.readonly = loadedAddresses.readonly.map(
          (key) => new PublicKey(key)
        );
      }
    }
    // Deserialize transaction message
    let message = VersionedMessage.deserialize(
      tx.transaction.message as any as Buffer
    );
    tx.transaction.message = message;
  }
  return block;
}

export async function fetchBlock(
  dispatch: Dispatch,
  url: string,
  cluster: Cluster,
  slot: number
) {
  dispatch({
    type: ActionType.Update,
    status: FetchStatus.Fetching,
    key: slot,
    url,
  });

  let status: FetchStatus;
  let data: Block | undefined = undefined;

  try {
    const connection = new Connection(url, "confirmed");

    const block = await _fetchBlock(url, slot);
    if (block === null) {
      data = {};
      status = FetchStatus.Fetched;
    } else {
      const childSlot = (
        await connection.getBlocks(slot + 1, slot + 100)
      ).shift();
      const firstLeaderSlot = block.parentSlot;

      let leaders: PublicKey[] = [];
      try {
        const lastLeaderSlot = childSlot !== undefined ? childSlot : slot;
        const slotLeadersLimit = lastLeaderSlot - block.parentSlot + 1;
        leaders = await connection.getSlotLeaders(
          firstLeaderSlot,
          slotLeadersLimit
        );
      } catch (err) {
        // ignore errors
      }

      const getLeader = (slot: number) => {
        return leaders.at(slot - firstLeaderSlot);
      };

      data = {
        block,
        blockLeader: getLeader(slot),
        childSlot,
        childLeader: childSlot !== undefined ? getLeader(childSlot) : undefined,
        parentLeader: getLeader(block.parentSlot),
      };
      status = FetchStatus.Fetched;
    }
  } catch (err) {
    status = FetchStatus.FetchFailed;
    if (cluster !== Cluster.Custom) {
      Sentry.captureException(err, { tags: { url } });
    }
  }

  dispatch({
    type: ActionType.Update,
    url,
    key: slot,
    status,
    data,
  });
}

export function useFetchBlock() {
  const dispatch = React.useContext(DispatchContext);
  if (!dispatch) {
    throw new Error(`useFetchBlock must be used within a BlockProvider`);
  }

  const { cluster, url } = useCluster();
  return React.useCallback(
    (key: number) => fetchBlock(dispatch, url, cluster, key),
    [dispatch, cluster, url]
  );
}
