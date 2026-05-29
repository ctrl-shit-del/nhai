import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export interface NetworkState {
  isConnected: boolean;
  type: 'none' | 'wifi' | 'cellular' | 'unknown';
}

export function useNetworkMonitor(): NetworkState {
  const [state, setState] = useState<NetworkState>({
    isConnected: false,
    type: 'unknown'
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((nextState) => {
      setState({
        isConnected: Boolean(nextState.isConnected && nextState.isInternetReachable !== false),
        type: mapNetworkType(nextState.type)
      });
    });

    return unsubscribe;
  }, []);

  return state;
}

function mapNetworkType(type: NetInfoStateType): NetworkState['type'] {
  if (type === NetInfoStateType.wifi) return 'wifi';
  if (type === NetInfoStateType.cellular) return 'cellular';
  if (type === NetInfoStateType.none) return 'none';
  return 'unknown';
}
