#requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][Guid]$TenantId,
    [Parameter(Mandatory)][Guid]$AppId,
    [Parameter(Mandatory)][string]$Organization,
    [Parameter(Mandatory)][string]$CertificateThumbprint,
    [Parameter(Mandatory)][string]$AtlasUrl
)
$ErrorActionPreference='Stop'
Import-Module ExchangeOnlineManagement
. (Join-Path $PSScriptRoot 'Send-AtlasSnapshot.ps1')
$records=[Collections.Generic.List[object]]::new()
$complete=$true
Connect-ExchangeOnline -AppId $AppId.ToString() -CertificateThumbprint $CertificateThumbprint -Organization $Organization -ShowBanner:$false
try {
    $mailboxes=Get-EXOMailbox -ResultSize Unlimited -Properties GrantSendOnBehalfTo,ForwardingAddress,ForwardingSmtpAddress,DeliverToMailboxAndForward,WhenCreated
    foreach($mailbox in $mailboxes) {
        $smtp=$mailbox.PrimarySmtpAddress.ToString().ToLowerInvariant()
        $key='mailbox:'+$smtp
        $records.Add(@{ id=$smtp; recordType='resource'; key=$key; name=$mailbox.DisplayName; kind='mailbox'; primarySmtpAddress=$smtp; recipientTypeDetails=$mailbox.RecipientTypeDetails.ToString(); directoryObjectId=$mailbox.ExternalDirectoryObjectId; createdAt=if($mailbox.WhenCreated){$mailbox.WhenCreated.ToUniversalTime().ToString('o')}else{$null}; forwardingAddress=[string]$mailbox.ForwardingAddress; forwardingSmtpAddress=[string]$mailbox.ForwardingSmtpAddress; deliverToMailboxAndForward=[bool]$mailbox.DeliverToMailboxAndForward; grantSendOnBehalfTo=@($mailbox.GrantSendOnBehalfTo | ForEach-Object { [string]$_ }) })
        try {
            foreach($permission in (Get-EXOMailboxPermission -Identity $smtp)) {
                $principal=[string]$permission.User
                $records.Add(@{ id="$smtp|FullAccess|$principal"; recordType='permission'; resourceKey=$key; principalKey='upn:'+$principal.ToLowerInvariant(); role=(@($permission.AccessRights) -join ','); relation='mailbox_permission'; inherited=[bool]$permission.IsInherited; deny=[bool]$permission.Deny; identityResolution='UPN quando retornado pela fonte; SIDs e grupos podem exigir resolução adicional' })
            }
            foreach($permission in (Get-EXORecipientPermission -Identity $smtp)) {
                $principal=[string]$permission.Trustee
                $records.Add(@{ id="$smtp|SendAs|$principal"; recordType='permission'; resourceKey=$key; principalKey='upn:'+$principal.ToLowerInvariant(); role=(@($permission.AccessRights) -join ','); relation='mailbox_permission'; accessControlType=[string]$permission.AccessControlType; inherited=[bool]$permission.IsInherited })
            }
        } catch { $complete=$false; Write-Warning "Coleta de delegações incompleta para uma caixa. Consulte as permissões Exchange do coletor." }
    }
    try {
        foreach($rule in (Get-TransportRule)) { $records.Add(@{ id='transport-rule:'+([string]$rule.Identity); recordType='resource'; key='exchange-rule:'+([string]$rule.Identity); name=$rule.Name; kind='transportRule'; state=[string]$rule.State; mode=[string]$rule.Mode; priority=$rule.Priority; description=[string]$rule.Description }) }
        $org=Get-OrganizationConfig | Select-Object Identity,DisplayName,AuditDisabled,OAuth2ClientProfileEnabled,DefaultAuthenticationPolicy
        $records.Add(@{ id='organization-config'; recordType='resource'; key='exchange:organization'; name='Exchange Organization Configuration'; kind='exchangeConfiguration'; configuration=$org })
        foreach($domain in (Get-AcceptedDomain)) { $records.Add(@{ id='domain:'+([string]$domain.DomainName); recordType='resource'; key='exchange-domain:'+([string]$domain.DomainName); name=[string]$domain.DomainName; kind='acceptedDomain'; domainType=[string]$domain.DomainType; isDefault=[bool]$domain.Default }) }
    } catch { $complete=$false; Write-Warning 'Snapshot de regras e configurações incompleto. Os registros obtidos serão enviados como parciais.' }
    Send-AtlasSnapshot -AtlasUrl $AtlasUrl -TenantId $TenantId -Source 'bridge.exchange' -Records $records.ToArray() -Complete $complete
} finally { Disconnect-ExchangeOnline -Confirm:$false }
