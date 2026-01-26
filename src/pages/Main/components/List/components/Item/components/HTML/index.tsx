import type { HistoryTablePayload } from "@/types/database";
import DOMPurify from "dompurify";
import { type FC, memo } from "react";

const HTML: FC<Partial<HistoryTablePayload>> = (props) => {
	const { value = "" } = props;

	return (
		<div
			className="translate-z-0 pointer-events-none"
			dangerouslySetInnerHTML={{
				__html: DOMPurify.sanitize(value, {
					FORBID_ATTR: ["target", "controls", "autoplay", "autoPlay"],
				}),
			}}
		/>
	);
};

export default memo(HTML);
