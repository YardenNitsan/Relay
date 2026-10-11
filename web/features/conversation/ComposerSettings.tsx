import type {ReactNode,RefObject} from 'react';
import {Modal} from '../../components/ui';
import {useModalDraftGuard} from '../../components/modal-guard';

function SettingsBody({busy,children,formRef}:{busy:boolean;children:ReactNode;formRef:RefObject<HTMLFormElement|null>}){
  useModalDraftGuard({busy,dirty:false,label:'objective settings'});
  return <form ref={formRef} id="execution-options" className="composer-settings-body" onSubmit={event=>event.preventDefault()}>{children}</form>;
}
export default function ComposerSettings({busy,onClose,children,formRef}:{busy:boolean;onClose:()=>void;children:ReactNode;formRef:RefObject<HTMLFormElement|null>}){
  return <Modal title="Execution options" className="composer-settings" onClose={onClose}>
    <SettingsBody busy={busy} formRef={formRef}>{children}</SettingsBody>
  </Modal>;
}
