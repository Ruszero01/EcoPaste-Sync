import { useCallback, useEffect, useRef } from "react";
import { subscribeKey } from "valtio/utils";

export const useImmediateKey = <T extends object>(
	object: T,
	key: keyof T,
	callback: (value: T[keyof T]) => void,
) => {
	const callbackRef = useRef(callback);
	callbackRef.current = callback;

	const stableCallback = useCallback((value: T[keyof T]) => {
		callbackRef.current(value);
	}, []);

	useEffect(() => {
		// 立即调用一次
		stableCallback(object[key]);

		// 订阅变化
		const unsubscribe = subscribeKey(object, key as string, stableCallback);

		return unsubscribe;
	}, [object, key, stableCallback]);
};
