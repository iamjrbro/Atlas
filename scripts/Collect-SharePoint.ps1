#requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][Guid]$TenantId,
    [Parameter(Mandatory)][Guid]$AppId,
    [Parameter(Mandatory)][string]$TenantDomain,
    [Parameter(Mandatory)][string]$CertificateThumbprint,
    [Parameter(Mandatory)][string[]]$SiteUrls,
    [Parameter(Mandatory)][string]$AtlasUrl
)
$ErrorActionPreference='Stop'
Import-Module PnP.PowerShell
. (Join-Path $PSScriptRoot 'Send-AtlasSnapshot.ps1')
$records=[Collections.Generic.List[object]]::new()
$complete=$true
foreach($siteUrl in $SiteUrls) {
    $uri=[Uri]$siteUrl
    if($uri.Scheme -ne 'https' -or $uri.Host -notmatch '\.sharepoint\.com$') { throw 'SiteUrls aceita somente sites HTTPS SharePoint Online da nuvem pública.' }
    try {
        $connection=Connect-PnPOnline -Url $siteUrl -ClientId $AppId.ToString() -Tenant $TenantDomain -Thumbprint $CertificateThumbprint -ReturnConnection
        $webs=@(Get-PnPWeb -Includes RoleAssignments,HasUniqueRoleAssignments -Connection $connection)+@(Get-PnPSubWeb -Recurse -Includes RoleAssignments,HasUniqueRoleAssignments -Connection $connection)
        foreach($web in $webs) {
            $key='sharepoint-web:'+$web.Url.ToLowerInvariant()
            $records.Add(@{ id=$web.Url; recordType='resource'; key=$key; name=$web.Title; kind='sharepointWeb'; url=$web.Url; hasUniqueRoleAssignments=[bool]$web.HasUniqueRoleAssignments; scope='web-level ACL; não inclui ACLs de listas/itens' })
            foreach($assignment in $web.RoleAssignments) {
                Get-PnPProperty -ClientObject $assignment -Property Member,RoleDefinitionBindings -Connection $connection | Out-Null
                $member=$assignment.Member
                $principalKey='sharepoint-principal:'+([string]$member.LoginName).ToLowerInvariant()
                if([string]$member.PrincipalType -eq 'SharePointGroup') { $principalKey='sharepoint-group:'+$web.Url.ToLowerInvariant()+':'+$member.Id }
                if([string]$member.LoginName -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$') { $principalKey='entra:'+$Matches[1].ToLowerInvariant() }
                elseif([string]$member.LoginName -match '\|([^|]+@[^|]+)$') { $principalKey='upn:'+$Matches[1].ToLowerInvariant() }
                $records.Add(@{ id="$($web.Url)|$($member.Id)"; recordType='permission'; resourceKey=$key; principalKey=$principalKey; role=(@($assignment.RoleDefinitionBindings | ForEach-Object { $_.Name }) -join ','); relation='sharepoint_web_acl'; inherited=-not [bool]$web.HasUniqueRoleAssignments; principalType=[string]$member.PrincipalType; principalName=$member.Title })
                if([string]$member.PrincipalType -eq 'SharePointGroup') {
                    try {
                        foreach($groupMember in (Get-PnPGroupMember -Identity $member.Id -Connection $connection)) {
                            $memberKey='sharepoint-principal:'+([string]$groupMember.LoginName).ToLowerInvariant()
                            if([string]$groupMember.LoginName -match '\|([^|]+@[^|]+)$') { $memberKey='upn:'+$Matches[1].ToLowerInvariant() }
                            $records.Add(@{ id="$($web.Url)|$($member.Id)|$($groupMember.Id)"; recordType='permission'; resourceKey=$principalKey; principalKey=$memberKey; role='SharePoint group member'; relation='member_of' })
                        }
                    } catch { $complete=$false; Write-Warning 'Membros de um grupo SharePoint não puderam ser lidos.' }
                }
            }
        }
        Disconnect-PnPOnline -Connection $connection
    } catch { $complete=$false; Write-Warning 'Um site não pôde ser coletado. Snapshot será marcado parcial.' }
}
# Sempre parcial no sentido global: a lista SiteUrls não comprova cobertura de todos os sites do tenant.
# Complete significa apenas execução integral da lista configurada; informe sempre o mesmo escopo.
Send-AtlasSnapshot -AtlasUrl $AtlasUrl -TenantId $TenantId -Source 'bridge.sharepoint' -Records $records.ToArray() -Complete $complete
